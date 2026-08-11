import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const updateResultSchema = z
  .object({
    status: z.enum(["PASSED", "FAILED", "SKIPPED"]).optional(),
    notes: z.string().max(10_000).optional(),
  })
  // The client saves status and notes independently (saving notes must
  // never re-send a stale status and clobber a concurrent status update),
  // so at least one of the two must be present but neither is required.
  .refine((data) => data.status !== undefined || data.notes !== undefined, {
    message: "At least one of status or notes must be provided.",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; resultId: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId, resultId } = await params;

  const run = await db.testRun.findUnique({
    where: { id: runId },
    select: { id: true, projectId: true, source: true },
  });

  if (!run || run.source !== "MANUAL") {
    return NextResponse.json({ error: "Manual run not found." }, { status: 404 });
  }

  if (!(await userCanWriteToProject(session.user.id, run.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = updateResultSchema.parse(await request.json());

    const target = await db.testResult.findFirst({
      where: { id: resultId, runId },
      select: { id: true },
    });

    if (!target) {
      return NextResponse.json({ error: "Result not found." }, { status: 404 });
    }

    await db.testResult.update({
      where: { id: target.id },
      data: {
        ...(payload.status !== undefined && { status: payload.status }),
        ...(payload.notes !== undefined && { notes: payload.notes }),
      },
    });

    const statuses = await db.testResult.findMany({
      where: { runId },
      select: { status: true },
    });

    const inProgress = statuses.some((item: { status: string }) => item.status === "BLOCKED");

    if (!inProgress) {
      await db.testRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid manual result payload.", issues: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Unable to update result." }, { status: 500 });
  }
}
