import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBasicAuth } from "@/lib/api-auth";
import { userIsProjectAdmin } from "@/lib/projects";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await resolveBasicAuth(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });

  const { id } = await params;

  // Find the key, verify user is a member of the key's project
  const apiKey = await db.apiKey.findFirst({
    where: {
      id,
      project: {
        members: { some: { userId: user.id } },
      },
    },
  });

  // Return 404 whether key doesn't exist or user doesn't have access (avoid leaking existence)
  if (!apiKey) return NextResponse.json({ error: "API key not found." }, { status: 404 });

  // Deleting a key revokes project access it grants — same bar as minting one
  // (see POST /api/v1/api-keys). Membership alone would let a VIEWER delete
  // any key in the project.
  if (!(await userIsProjectAdmin(user.id, apiKey.projectId))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  await db.apiKey.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
