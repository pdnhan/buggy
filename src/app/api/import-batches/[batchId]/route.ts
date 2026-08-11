import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

// ─── PATCH /api/import-batches/[batchId] ──────────────────────────────────────
// Dismisses the banner for an import batch without deleting the cases.
// Body: { dismissed: true }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { batchId } = await params;

  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await userCanWriteToProject(session.user.id, batch.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await db.importBatch.update({
    where: { id: batchId },
    data: { dismissed: true },
  });

  return NextResponse.json(updated);
}

// ─── DELETE /api/import-batches/[batchId] ─────────────────────────────────────
// Undoes an import: deletes all test cases that still belong to this batch
// (those that have been added to a suite already have importBatchId=null and
// are NOT deleted), then deletes the batch record itself.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { batchId } = await params;

  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await userCanWriteToProject(session.user.id, batch.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete remaining cases + the batch in a single transaction
  const result = await db.$transaction(async (tx) => {
    const deleted = await tx.testCase.deleteMany({
      where: { importBatchId: batchId },
    });
    await tx.importBatch.delete({ where: { id: batchId } });
    return { deleted: deleted.count };
  });

  return NextResponse.json(result);
}
