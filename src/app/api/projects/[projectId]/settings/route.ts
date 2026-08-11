import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";
import { sanitizeTestCasePrefix } from "@/lib/test-case-ids";

const updateSchema = z
  .object({
    testCasePrefix: z
      .string()
      .trim()
      .min(2)
      .max(6)
      .regex(/^[A-Z0-9]+$/i, { message: "Prefix must be alphanumeric." })
      .optional(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.testCasePrefix || v.name || v.description !== undefined, {
    message: "At least one field must be provided.",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  if (!(await userCanWriteToProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const payload = updateSchema.parse(await request.json());
    const updateData: Record<string, unknown> = {};

    if (payload.testCasePrefix) {
      updateData.testCasePrefix = sanitizeTestCasePrefix(payload.testCasePrefix);
    }
    if (payload.name) {
      updateData.name = payload.name;
    }
    if (payload.description !== undefined) {
      updateData.description = payload.description || null;
    }

    const project = await db.project.update({
      where: { id: projectId },
      data: updateData,
      select: { id: true, name: true, description: true, testCasePrefix: true },
    });

    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[PATCH /api/projects/[id]/settings]", error);
    return NextResponse.json({ error: "Unable to update settings." }, { status: 500 });
  }
}
