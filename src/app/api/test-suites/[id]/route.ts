import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
});

// Both callers below are writes (rename/delete a suite) — VIEWER must not
// pass this check, so this uses userCanWriteToProject rather than mere
// membership.
async function getSuiteWithAccess(userId: string, suiteId: string) {
  const suite = await db.testSuite.findUnique({ where: { id: suiteId } });
  if (!suite) return null;
  if (!(await userCanWriteToProject(userId, suite.projectId))) return null;
  return suite;
}

// ─── PATCH /api/test-suites/[id] ─────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const payload = patchSchema.parse(await request.json());
    const suite = await getSuiteWithAccess(session.user.id, id);
    if (!suite) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await db.testSuite.update({
      where: { id },
      data: {
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && { description: payload.description }),
      },
    });

    return NextResponse.json({ suite: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[PATCH /api/test-suites/[id]]", error);
    return NextResponse.json({ error: "Unable to update suite." }, { status: 500 });
  }
}

// ─── DELETE /api/test-suites/[id] ────────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const suite = await getSuiteWithAccess(session.user.id, id);
  if (!suite) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.testSuite.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
