import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole, userHasProjectAccess } from "@/lib/projects";
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
import type { BugStatus, Prisma } from "@prisma/client";

const leakageOverrideSchema = z.object({
  isLeaked: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

// "REOPENED" is deliberately excluded — reopening a bug must go through
// POST /api/bugs/[id]/reopen so a ReopenEvent (with a reason) is always created.
const updatableStatuses = BUG_STATUS_VALUES.filter((s) => s !== "REOPENED") as [
  BugStatus,
  ...BugStatus[],
];

const updateBugSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional().nullable(),
  externalIssueId: z.string().trim().max(64).optional().nullable(),
  issueTrackerUrl: z.string().trim().max(500).optional().nullable(),
  moduleName: z.string().trim().min(1).max(120).optional().nullable(),
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
  leakageOverride: leakageOverrideSchema.optional(),
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

const bugInclude = {
  module: true,
  assignedDeveloper: { select: { id: true, name: true, email: true } },
  responsibleQa: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  reopenEvents: { orderBy: { sequenceNumber: "asc" as const } },
} satisfies Prisma.BugInclude;

async function getBugWithAccess(userId: string, bugId: string) {
  const bug = await db.bug.findUnique({ where: { id: bugId }, include: bugInclude });
  if (!bug) return null;
  if (!(await userHasProjectAccess(userId, bug.projectId))) return null;
  return bug;
}

// ─── GET /api/bugs/[id] ────────────────────────────────────────────────────────

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bug = await getBugWithAccess(session.user.id, id);
  if (!bug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ bug });
}

// ─── PUT /api/bugs/[id] ─────────────────────────────────────────────────────────

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const payload = updateBugSchema.parse(await request.json());

    const existing = await db.bug.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const role = await getProjectRole(session.user.id, existing.projectId);
    if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Viewers cannot edit bugs." }, { status: 403 });
    }

    if (payload.leakageOverride && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only a QA lead or project admin can override the leakage classification." },
        { status: 403 }
      );
    }

    const nextPhase = payload.detectionPhase ?? existing.detectionPhase;
    const carriedOverOverride =
      !payload.leakageOverride && existing.leakageOverridden
        ? { isLeaked: existing.isLeaked, reason: existing.leakageOverrideReason ?? "" }
        : null;
    const leakage = resolveLeakage(nextPhase, payload.leakageOverride ?? carriedOverOverride);
    if (leakage.error) {
      return NextResponse.json({ error: leakage.error }, { status: 400 });
    }

    let moduleId = existing.moduleId;
    if (payload.moduleName !== undefined) {
      if (payload.moduleName === null || payload.moduleName === "") {
        moduleId = null;
      } else {
        const mod = await db.module.upsert({
          where: { projectId_name: { projectId: existing.projectId, name: payload.moduleName } },
          update: {},
          create: { projectId: existing.projectId, name: payload.moduleName },
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
          ...(payload.externalIssueId !== undefined && { externalIssueId: payload.externalIssueId }),
          ...(payload.issueTrackerUrl !== undefined && { issueTrackerUrl: payload.issueTrackerUrl }),
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
      if (payload.leakageOverride) {
        changes.leakageOverride = {
          from: { isLeaked: existing.isLeaked, overridden: existing.leakageOverridden },
          to: { isLeaked: leakage.isLeaked, reason: leakage.leakageOverrideReason },
        };
      }

      if (Object.keys(changes).length > 0) {
        await auditLogEntry(tx, {
          actorId: session.user.id,
          action: "bug_update",
          targetId: bug.id,
          metadata: changes as Prisma.InputJsonValue,
        });
      }

      return bug;
    });

    return NextResponse.json({ bug: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[PUT /api/bugs/[id]]", error);
    return NextResponse.json({ error: "Unable to update bug." }, { status: 500 });
  }
}

// ─── DELETE /api/bugs/[id] ────────────────────────────────────────────────────

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await db.bug.findUnique({ where: { id }, select: { id: true, projectId: true, displayId: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const role = await getProjectRole(session.user.id, existing.projectId);
  if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Only a project admin can delete a bug." }, { status: 403 });
  }

  await db.$transaction([
    db.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "bug_delete",
        targetId: existing.id,
        metadata: { projectId: existing.projectId, displayId: existing.displayId },
      },
    }),
    db.bug.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
