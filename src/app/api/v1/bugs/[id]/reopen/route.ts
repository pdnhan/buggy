import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { canReopen, nextReopenSequenceNumber } from "@/lib/bug-tracking";
import { REOPEN_REASON_VALUES } from "@/lib/bug-enums";
import { formatBug, bugInclude } from "@/lib/api-formatters";
import { findNonMemberIds } from "@/lib/project-membership";

const reopenSchema = z.object({
  reason: z.enum(REOPEN_REASON_VALUES),
  comment: z.string().trim().max(5_000).optional(),
  environment: z.string().trim().max(100).optional(),
  releaseOrBuild: z.string().trim().max(100).optional(),
  assignedDeveloperId: z.string().optional(),
  responsibleQaId: z.string().optional(),
});

// ─── POST /api/v1/bugs/[id]/reopen ────────────────────────────────────────────

export async function POST(
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
    const payload = reopenSchema.parse(await request.json());

    const bug = await db.bug.findFirst({
      where: { id, projectId: apiKey.projectId },
    });
    if (!bug) return NextResponse.json({ error: "Bug not found." }, { status: 404 });

    if (!canReopen(bug.status)) {
      return NextResponse.json(
        {
          error:
            "A bug can only be reopened once it has reached a Fixed, Resolved, or Closed status.",
        },
        { status: 400 }
      );
    }

    // CQ-105: assignee ids must belong to the key's project — mirrors the
    // same check on POST /api/bugs, PUT /api/bugs/[id], POST /api/v1/bugs,
    // and PATCH /api/v1/bugs/[id]. Without it, a cross-tenant user id could
    // be persisted on both the ReopenEvent and the Bug, and the response's
    // `include` would leak that user's name/email. Run BEFORE the
    // transaction opens so a rejected request performs no writes at all.
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
          reopenedById: apiKey.userId,
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
        include: bugInclude,
      });

      return { bug: updatedBug, reopenEvent };
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json(
      { bug: formatBug(result.bug), reopen_event: result.reopenEvent },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[POST /api/v1/bugs/[id]/reopen]", error);
    return NextResponse.json({ error: "Unable to reopen bug." }, { status: 500 });
  }
}
