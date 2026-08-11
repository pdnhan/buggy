import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const apiKey = await db.apiKey.findUnique({
    where: { id },
    select: { projectId: true },
  });

  if (!apiKey) {
    return NextResponse.json({ error: "API key not found." }, { status: 404 });
  }

  if (!(await userCanWriteToProject(session.user.id, apiKey.projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.apiKey.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
