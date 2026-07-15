import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, getProjectRole, userHasProjectAccess } from "@/lib/projects";
import { reserveBugDisplayIds } from "@/lib/bug-ids";
import { resolveLeakage } from "@/lib/bug-tracking";
import { auditLogEntry } from "@/lib/audit";
import { buildBugWhere } from "@/lib/bug-filters";
import {
  BUG_SEVERITY_VALUES,
  BUG_PRIORITY_VALUES,
  DETECTION_SOURCE_VALUES,
  DETECTION_PHASE_VALUES,
  ROOT_CAUSE_VALUES,
} from "@/lib/bug-enums";

// ─── Validation ─────────────────────────────────────────────────────────────

const leakageOverrideSchema = z.object({
  isLeaked: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

const createBugSchema = z.object({
  projectId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  externalIssueId: z.string().trim().max(64).optional(),
  issueTrackerUrl: z.string().trim().max(500).optional(),
  moduleName: z.string().trim().min(1).max(120).optional(),
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
  leakageOverride: leakageOverrideSchema.optional(),
  assignedDeveloperId: z.string().optional(),
  responsibleQaId: z.string().optional(),
  reporterId: z.string().optional(),
  clientImpact: z.string().max(2_000).optional(),
  businessImpact: z.string().max(2_000).optional(),
  reproductionSteps: z.string().max(10_000).optional(),
  expectedResult: z.string().max(5_000).optional(),
  actualResult: z.string().max(5_000).optional(),
  notes: z.string().max(10_000).optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  firstDetectedDate: z.string().datetime().optional(),
});

// ─── GET /api/bugs ────────────────────────────────────────────────────────────
// Filters mirror section 10 of the spec. Supports cursor-based pagination.

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedProjectId = searchParams.get("projectId");
  const cursor = searchParams.get("cursor") ?? undefined;
  const rawLimit = Number(searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(rawLimit, 1), 200);

  const project = requestedProjectId
    ? { id: requestedProjectId }
    : await ensureProjectForUser(session.user.id);

  if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userHasProjectAccess(session.user.id, project.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where = buildBugWhere(searchParams, project.id);

  const bugs = await db.bug.findMany({
    where,
    include: {
      module: true,
      assignedDeveloper: { select: { id: true, name: true, email: true } },
      responsibleQa: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = bugs.length > limit;
  const page = hasNextPage ? bugs.slice(0, limit) : bugs;
  const nextCursor = hasNextPage ? page[page.length - 1]?.id : undefined;

  return NextResponse.json({ bugs: page, nextCursor, hasNextPage, projectId: project.id });
}

// ─── POST /api/bugs ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = createBugSchema.parse(await request.json());
    const project = payload.projectId
      ? { id: payload.projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = await getProjectRole(session.user.id, project.id);
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Viewers cannot create bugs." }, { status: 403 });
    }

    if (payload.leakageOverride && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only a QA lead or project admin can override the leakage classification." },
        { status: 403 }
      );
    }

    const leakage = resolveLeakage(payload.detectionPhase, payload.leakageOverride ?? null);
    if (leakage.error) {
      return NextResponse.json({ error: leakage.error }, { status: 400 });
    }

    const bug = await db.$transaction(async (tx) => {
      const moduleRecord = payload.moduleName
        ? await tx.module.upsert({
            where: { projectId_name: { projectId: project.id, name: payload.moduleName } },
            update: {},
            create: { projectId: project.id, name: payload.moduleName },
          })
        : null;

      const [displayId] = await reserveBugDisplayIds(tx, project.id, 1);

      const created = await tx.bug.create({
        data: {
          projectId: project.id,
          moduleId: moduleRecord?.id,
          displayId,
          externalIssueId: payload.externalIssueId,
          issueTrackerUrl: payload.issueTrackerUrl,
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
          leakageOverridden: leakage.leakageOverridden,
          leakageOverrideReason: leakage.leakageOverrideReason,
          assignedDeveloperId: payload.assignedDeveloperId,
          responsibleQaId: payload.responsibleQaId,
          reporterId: payload.reporterId ?? session.user.id,
          clientImpact: payload.clientImpact,
          businessImpact: payload.businessImpact,
          reproductionSteps: payload.reproductionSteps,
          expectedResult: payload.expectedResult,
          actualResult: payload.actualResult,
          notes: payload.notes,
          labels: payload.labels,
          firstDetectedDate: payload.firstDetectedDate ? new Date(payload.firstDetectedDate) : null,
        },
        include: { module: true },
      });

      await auditLogEntry(tx, {
        actorId: session.user.id,
        action: "bug_create",
        targetId: created.id,
        metadata: {
          projectId: project.id,
          displayId: created.displayId,
          severity: created.severity,
          detectionPhase: created.detectionPhase,
          isLeaked: created.isLeaked,
          leakageOverridden: created.leakageOverridden,
        },
      });

      return created;
    });

    return NextResponse.json({ bug }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid bug payload.", issues: error.issues },
        { status: 400 }
      );
    }

    console.error("[POST /api/bugs]", error);
    return NextResponse.json({ error: "Unable to create bug." }, { status: 500 });
  }
}
