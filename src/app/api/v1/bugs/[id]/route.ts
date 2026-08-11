import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { resolveLeakage, requiresRootCauseBeforeClosure } from "@/lib/bug-tracking";
import { auditLogEntry } from "@/lib/audit";
import {
  BUG_SEVERITY_VALUES,
  BUG_PRIORITY_VALUES,
  BUG_STATUS_VALUES,
  DETECTION_SOURCE_VALUES,
  DETECTION_PHASE_VALUES,
  ROOT_CAUSE_VALUES,
} from "@/lib/bug-enums";
import { formatBug, bugInclude } from "@/lib/api-formatters";
import { findNonMemberIds } from "@/lib/project-membership";
import type { BugStatus, Prisma } from "@prisma/client";

// "REOPENED" is deliberately excluded — reopening a bug must go through
// POST /api/v1/bugs/[id]/reopen so a ReopenEvent (with a reason) is always created.
const updatableStatuses = BUG_STATUS_VALUES.filter((s) => s !== "REOPENED") as [
  BugStatus,
  ...BugStatus[],
];

const updateBugSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional().nullable(),
  // snake_case is v1's primary spelling for these two fields — see the
  // matching comment in the sibling create route (POST /api/v1/bugs) for
  // the full rationale. camelCase stays accepted for back-compat.
  external_issue_id: z.string().trim().max(64).optional().nullable(),
  issue_tracker_url: z.string().trim().max(500).optional().nullable(),
  externalIssueId: z.string().trim().max(64).optional().nullable(),
  issueTrackerUrl: z.string().trim().max(500).optional().nullable(),
  module_name: z.string().trim().min(1).max(120).optional().nullable(),
  sprint: z.string().trim().max(100).optional().nullable(),
  release: z.string().trim().max(100).optional().nullable(),
  fixVersion: z.string().trim().max(100).optional().nullable(),
  severity: z.enum(BUG_SEVERITY_VALUES).optional(),
  priority: z.enum(BUG_PRIORITY_VALUES).optional(),
  bugType: z.string().trim().max(100).optional().nullable(),
  rootCause: z.enum(ROOT_CAUSE_VALUES).optional().nullable(),
  detectionSource: z.enum(DETECTION_SOURCE_VALUES).optional(),
  detectionPhase: z.enum(DETECTION_PHASE_VALUES).optional(),
  environment: z.string().trim().max(100).optional().nullable(),
  isRegression: z.boolean().optional(),
  assignedDeveloperId: z.string().optional().nullable(),
  responsibleQaId: z.string().optional().nullable(),
  status: z.enum(updatableStatuses).optional(),
  clientImpact: z.string().max(2_000).optional().nullable(),
  businessImpact: z.string().max(2_000).optional().nullable(),
  reproductionSteps: z.string().max(10_000).optional().nullable(),
  expectedResult: z.string().max(5_000).optional().nullable(),
  actualResult: z.string().max(5_000).optional().nullable(),
  notes: z.string().max(10_000).optional().nullable(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  firstDetectedDate: z.string().datetime().optional().nullable(),
});

// ─── GET /api/v1/bugs/[id] ────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { id } = await params;
  const bug = await db.bug.findFirst({
    where: { id, projectId: apiKey.projectId },
    include: bugInclude,
  });

  if (!bug) return NextResponse.json({ error: "Bug not found." }, { status: 404 });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({ bug: formatBug(bug) });
}

// ─── PATCH /api/v1/bugs/[id] ──────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  const { id } = await params;

  try {
    const payload = updateBugSchema.parse(await request.json());
    // snake_case is primary (see schema comment above); camelCase wins only
    // if a caller somehow sends both. Falls back to the snake_case field
    // whenever the camelCase one is entirely absent from the payload (as
    // opposed to explicitly `null`), so `null` still means "clear it".
    const externalIssueId =
      payload.externalIssueId !== undefined ? payload.externalIssueId : payload.external_issue_id;
    const issueTrackerUrl =
      payload.issueTrackerUrl !== undefined ? payload.issueTrackerUrl : payload.issue_tracker_url;

    const existing = await db.bug.findFirst({
      where: { id, projectId: apiKey.projectId },
    });
    if (!existing) return NextResponse.json({ error: "Bug not found." }, { status: 404 });

    const nextPhase = payload.detectionPhase ?? existing.detectionPhase;
    // API keys do NOT support SETTING a leakage override — there is no
    // `leakageOverride` field on this route's schema, unlike the internal
    // PUT /api/bugs/[id] route. But a CI job PATCHing an unrelated field
    // (e.g. `notes`) must not SILENTLY ERASE an override an admin already
    // set through the UI (CQ-104): carry the existing override forward the
    // same way the internal route does, rather than hard-passing `null`.
    const carriedOverOverride = existing.leakageOverridden
      ? { isLeaked: existing.isLeaked, reason: existing.leakageOverrideReason ?? "" }
      : null;
    const leakage = resolveLeakage(nextPhase, carriedOverOverride);
    if (leakage.error) {
      return NextResponse.json({ error: leakage.error }, { status: 400 });
    }

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

    let moduleId = existing.moduleId;
    if (payload.module_name !== undefined) {
      if (payload.module_name === null || payload.module_name === "") {
        moduleId = null;
      } else {
        const mod = await db.module.upsert({
          where: { projectId_name: { projectId: apiKey.projectId, name: payload.module_name } },
          update: {},
          create: { projectId: apiKey.projectId, name: payload.module_name },
        });
        moduleId = mod.id;
      }
    }

    const nextSeverity = payload.severity ?? existing.severity;
    const nextRootCause = payload.rootCause !== undefined ? payload.rootCause : existing.rootCause;

    let firstFixedDate = existing.firstFixedDate;
    let lastFixedDate = existing.lastFixedDate;
    let closedDate = existing.closedDate;

    const enteringFixedOrResolved =
      payload.status && payload.status !== existing.status &&
      (payload.status === "FIXED" || payload.status === "RESOLVED");
    if (enteringFixedOrResolved) {
      firstFixedDate = firstFixedDate ?? new Date();
      lastFixedDate = new Date();
    }

    const enteringClosed = payload.status === "CLOSED" && existing.status !== "CLOSED";
    if (enteringClosed) {
      if (!firstFixedDate) {
        return NextResponse.json(
          { error: "A bug must have a fixed or resolved date before it can be closed." },
          { status: 400 }
        );
      }
      if (
        requiresRootCauseBeforeClosure({
          severity: nextSeverity,
          isLeaked: leakage.isLeaked,
          reopenCount: existing.reopenCount,
        }) &&
        !nextRootCause
      ) {
        return NextResponse.json(
          {
            error:
              "A root cause is required before closing a critical, high-severity, leaked, or reopened bug.",
          },
          { status: 400 }
        );
      }
      closedDate = new Date();
    }

    const updated = await db.$transaction(async (tx) => {
      const bug = await tx.bug.update({
        where: { id },
        data: {
          ...(payload.title !== undefined && { title: payload.title }),
          ...(payload.description !== undefined && { description: payload.description }),
          ...(externalIssueId !== undefined && { externalIssueId }),
          ...(issueTrackerUrl !== undefined && { issueTrackerUrl }),
          ...(payload.sprint !== undefined && { sprint: payload.sprint }),
          ...(payload.release !== undefined && { release: payload.release }),
          ...(payload.fixVersion !== undefined && { fixVersion: payload.fixVersion }),
          ...(payload.severity !== undefined && { severity: payload.severity }),
          ...(payload.priority !== undefined && { priority: payload.priority }),
          ...(payload.bugType !== undefined && { bugType: payload.bugType }),
          ...(payload.rootCause !== undefined && { rootCause: payload.rootCause }),
          ...(payload.detectionSource !== undefined && { detectionSource: payload.detectionSource }),
          ...(payload.detectionPhase !== undefined && { detectionPhase: payload.detectionPhase }),
          ...(payload.environment !== undefined && { environment: payload.environment }),
          ...(payload.isRegression !== undefined && { isRegression: payload.isRegression }),
          isLeaked: leakage.isLeaked,
          leakageOverridden: leakage.leakageOverridden,
          leakageOverrideReason: leakage.leakageOverrideReason,
          ...(payload.assignedDeveloperId !== undefined && {
            assignedDeveloperId: payload.assignedDeveloperId,
          }),
          ...(payload.responsibleQaId !== undefined && { responsibleQaId: payload.responsibleQaId }),
          ...(payload.status !== undefined && { status: payload.status }),
          ...(payload.clientImpact !== undefined && { clientImpact: payload.clientImpact }),
          ...(payload.businessImpact !== undefined && { businessImpact: payload.businessImpact }),
          ...(payload.reproductionSteps !== undefined && {
            reproductionSteps: payload.reproductionSteps,
          }),
          ...(payload.expectedResult !== undefined && { expectedResult: payload.expectedResult }),
          ...(payload.actualResult !== undefined && { actualResult: payload.actualResult }),
          ...(payload.notes !== undefined && { notes: payload.notes }),
          ...(payload.labels !== undefined && { labels: payload.labels }),
          ...(payload.firstDetectedDate !== undefined && {
            firstDetectedDate: payload.firstDetectedDate ? new Date(payload.firstDetectedDate) : null,
          }),
          moduleId,
          firstFixedDate,
          lastFixedDate,
          closedDate,
        },
        include: bugInclude,
      });

      // Mirrors the internal PUT /api/bugs/[id] route's audit trail (CQ-104)
      // — a v1 PATCH is otherwise a completely silent write, even when it
      // changes status/severity/rootCause/assignee or carries a leakage
      // override forward.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (payload.status !== undefined && payload.status !== existing.status) {
        changes.status = { from: existing.status, to: payload.status };
      }
      if (payload.severity !== undefined && payload.severity !== existing.severity) {
        changes.severity = { from: existing.severity, to: payload.severity };
      }
      if (payload.priority !== undefined && payload.priority !== existing.priority) {
        changes.priority = { from: existing.priority, to: payload.priority };
      }
      if (payload.rootCause !== undefined && payload.rootCause !== existing.rootCause) {
        changes.rootCause = { from: existing.rootCause, to: payload.rootCause };
      }
      if (
        payload.assignedDeveloperId !== undefined &&
        payload.assignedDeveloperId !== existing.assignedDeveloperId
      ) {
        changes.assignedDeveloperId = {
          from: existing.assignedDeveloperId,
          to: payload.assignedDeveloperId,
        };
      }

      if (Object.keys(changes).length > 0) {
        await auditLogEntry(tx, {
          // No session on the v1 (API-key-authenticated) path — attribute the
          // change to the key's owning user, same as the reopen event's
          // reopenedById in POST /api/v1/bugs/[id]/reopen.
          actorId: apiKey.userId,
          action: "bug_update",
          targetId: bug.id,
          metadata: changes as Prisma.InputJsonValue,
        });
      }

      return bug;
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json({ bug: formatBug(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[PATCH /api/v1/bugs/[id]]", error);
    return NextResponse.json({ error: "Unable to update bug." }, { status: 500 });
  }
}
