import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/projects";
import { canReopen, nextReopenSequenceNumber } from "@/lib/bug-tracking";
import { auditLogEntry } from "@/lib/audit";
import { REOPEN_REASON_VALUES } from "@/lib/bug-enums";

const reopenSchema = z.object({
  reason: z.enum(REOPEN_REASON_VALUES),
  comment: z.string().trim().max(5_000).optional(),
  environment: z.string().trim().max(100).optional(),
  releaseOrBuild: z.string().trim().max(100).optional(),
  assignedDeveloperId: z.string().optional(),
  responsibleQaId: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const payload = reopenSchema.parse(await request.json());

    const bug = await db.bug.findUnique({ where: { id } });
    if (!bug) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const role = await getProjectRole(session.user.id, bug.projectId);
    if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Viewers cannot reopen bugs." }, { status: 403 });
    }

    if (!canReopen(bug.status)) {
      return NextResponse.json(
        {
          error:
            "A bug can only be reopened once it has reached a Fixed, Resolved, or Closed status.",
        },
        { status: 400 }
      );
    }

    const now = new Date();

    const result = await db.$transaction(async (tx) => {
      const maxSequence = await tx.reopenEvent.aggregate({
        where: { bugId: id },
        _max: { sequenceNumber: true },
      });
      const sequenceNumber = nextReopenSequenceNumber(
        maxSequence._max.sequenceNumber ? [maxSequence._max.sequenceNumber] : []
      );

      const reopenEvent = await tx.reopenEvent.create({
        data: {
          bugId: id,
          sequenceNumber,
          previousStatus: bug.status,
          newStatus: "REOPENED",
          reopenedAt: now,
          reopenedById: session.user.id,
          reason: payload.reason,
          environment: payload.environment,
          releaseOrBuild: payload.releaseOrBuild,
          assignedDeveloperId: payload.assignedDeveloperId,
          responsibleQaId: payload.responsibleQaId,
          comment: payload.comment,
        },
      });

      const updatedBug = await tx.bug.update({
        where: { id },
        data: {
          status: "REOPENED",
          reopenCount: sequenceNumber,
          firstReopenedDate: bug.firstReopenedDate ?? now,
          lastReopenedDate: now,
          ...(payload.assignedDeveloperId !== undefined && {
            assignedDeveloperId: payload.assignedDeveloperId,
          }),
          ...(payload.responsibleQaId !== undefined && { responsibleQaId: payload.responsibleQaId }),
        },
        include: {
          module: true,
          assignedDeveloper: { select: { id: true, name: true, email: true } },
          responsibleQa: { select: { id: true, name: true, email: true } },
          reporter: { select: { id: true, name: true, email: true } },
          reopenEvents: { orderBy: { sequenceNumber: "asc" } },
        },
      });

      await auditLogEntry(tx, {
        actorId: session.user.id,
        action: "bug_reopen",
        targetId: id,
        metadata: {
          sequenceNumber,
          reason: payload.reason,
          previousStatus: bug.status,
        },
      });

      return { bug: updatedBug, reopenEvent };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[POST /api/bugs/[id]/reopen]", error);
    return NextResponse.json({ error: "Unable to reopen bug." }, { status: 500 });
  }
}
