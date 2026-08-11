import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { reserveBugDisplayIds } from "@/lib/bug-ids";
import { resolveLeakage } from "@/lib/bug-tracking";
import {
  BUG_SEVERITY_VALUES,
  BUG_PRIORITY_VALUES,
  DETECTION_SOURCE_VALUES,
  DETECTION_PHASE_VALUES,
  ROOT_CAUSE_VALUES,
} from "@/lib/bug-enums";
import { buildBugWhere } from "@/lib/bug-filters";
import { formatBug, bugInclude } from "@/lib/api-formatters";
import { findNonMemberIds } from "@/lib/project-membership";
import { parseLimitParam } from "@/lib/api-pagination";

// ─── Validation ─────────────────────────────────────────────────────────────

const createBugSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  // v1's response body (formatBug in src/lib/api-formatters.ts) already
  // emits these two fields — and every other multi-word field — as
  // snake_case, matching project_id/test_case_ids/module_name/expected_result
  // elsewhere in v1. snake_case is the primary, documented spelling; the
  // camelCase aliases are accepted only for backward compatibility with any
  // existing caller already using them. Zod silently drops unrecognized
  // keys, so previously an MCP client sending external_issue_id /
  // issue_tracker_url (the only names it knows) had the value discarded
  // with no error — see mcp-server/src/tools/bugs.ts.
  external_issue_id: z.string().trim().max(64).optional(),
  issue_tracker_url: z.string().trim().max(500).optional(),
  externalIssueId: z.string().trim().max(64).optional(),
  issueTrackerUrl: z.string().trim().max(500).optional(),
  module_name: z.string().trim().min(1).max(120).optional(),
  sprint: z.string().trim().max(100).optional(),
  release: z.string().trim().max(100).optional(),
  fixVersion: z.string().trim().max(100).optional(),
  severity: z.enum(BUG_SEVERITY_VALUES),
  priority: z.enum(BUG_PRIORITY_VALUES).default("MEDIUM"),
  bugType: z.string().trim().max(100).optional(),
  rootCause: z.enum(ROOT_CAUSE_VALUES).optional(),
  detectionSource: z.enum(DETECTION_SOURCE_VALUES).default("QA"),
  detectionPhase: z.enum(DETECTION_PHASE_VALUES),
  environment: z.string().trim().max(100).optional(),
  isRegression: z.boolean().default(false),
  assignedDeveloperId: z.string().optional(),
  responsibleQaId: z.string().optional(),
  clientImpact: z.string().max(2_000).optional(),
  businessImpact: z.string().max(2_000).optional(),
  reproductionSteps: z.string().max(10_000).optional(),
  expectedResult: z.string().max(5_000).optional(),
  actualResult: z.string().max(5_000).optional(),
  notes: z.string().max(10_000).optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  firstDetectedDate: z.string().datetime().optional(),
});

// ─── GET /api/v1/bugs ─────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitResult = parseLimitParam(searchParams, 50, 200);
  if (limitResult.error) return limitResult.error;
  const limit = limitResult.limit;

  const where = buildBugWhere(searchParams, apiKey.projectId);

  const bugs = await db.bug.findMany({
    where,
    include: bugInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = bugs.length > limit;
  const page = hasNextPage ? bugs.slice(0, limit) : bugs;
  const nextCursor = hasNextPage ? page[page.length - 1]?.id : undefined;

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({
    bugs: page.map(formatBug),
    next_cursor: nextCursor,
    has_next_page: hasNextPage,
    project_id: apiKey.projectId,
  });
}

// ─── POST /api/v1/bugs ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  try {
    const payload = createBugSchema.parse(await request.json());
    // snake_case is primary (see schema comment above); camelCase wins only
    // if a caller somehow sends both.
    const externalIssueId = payload.externalIssueId ?? payload.external_issue_id;
    const issueTrackerUrl = payload.issueTrackerUrl ?? payload.issue_tracker_url;

    // API key does NOT support leakage overrides — phase-based auto-classification only
    const leakage = resolveLeakage(payload.detectionPhase, null);

    const nonMemberIds = await findNonMemberIds(apiKey.projectId, [
      payload.assignedDeveloperId,
      payload.responsibleQaId,
    ]);
    if (nonMemberIds.length > 0) {
      return NextResponse.json(
        {
          error: `assignedDeveloperId and responsibleQaId must reference members of the project. Not a member: ${nonMemberIds.join(", ")}`,
        },
        { status: 422 }
      );
    }

    const bug = await db.$transaction(async (tx) => {
      const moduleRecord = payload.module_name
        ? await tx.module.upsert({
            where: { projectId_name: { projectId: apiKey.projectId, name: payload.module_name } },
            update: {},
            create: { projectId: apiKey.projectId, name: payload.module_name },
          })
        : null;

      const [displayId] = await reserveBugDisplayIds(tx, apiKey.projectId, 1);

      return tx.bug.create({
        data: {
          projectId: apiKey.projectId,
          moduleId: moduleRecord?.id,
          displayId,
          externalIssueId,
          issueTrackerUrl,
          title: payload.title,
          description: payload.description,
          sprint: payload.sprint,
          release: payload.release,
          fixVersion: payload.fixVersion,
          severity: payload.severity,
          priority: payload.priority,
          bugType: payload.bugType,
          rootCause: payload.rootCause,
          detectionSource: payload.detectionSource,
          detectionPhase: payload.detectionPhase,
          environment: payload.environment,
          isRegression: payload.isRegression,
          isLeaked: leakage.isLeaked,
          leakageOverridden: false,
          leakageOverrideReason: null,
          assignedDeveloperId: payload.assignedDeveloperId,
          responsibleQaId: payload.responsibleQaId,
          reporterId: apiKey.userId,
          clientImpact: payload.clientImpact,
          businessImpact: payload.businessImpact,
          reproductionSteps: payload.reproductionSteps,
          expectedResult: payload.expectedResult,
          actualResult: payload.actualResult,
          notes: payload.notes,
          labels: payload.labels,
          firstDetectedDate: payload.firstDetectedDate ? new Date(payload.firstDetectedDate) : null,
        },
        include: bugInclude,
      });
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json({ bug: formatBug(bug) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid bug payload.", issues: error.issues },
        { status: 400 }
      );
    }

    console.error("[POST /api/v1/bugs]", error);
    return NextResponse.json({ error: "Unable to create bug." }, { status: 500 });
  }
}
