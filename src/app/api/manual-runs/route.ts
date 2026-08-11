import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userCanWriteToProject } from "@/lib/projects";

const createManualRunSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200),
  testCaseIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = createManualRunSchema.parse(await request.json());
    const project = payload.projectId
      ? { id: payload.projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await userCanWriteToProject(session.user.id, project.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const testCases = await db.testCase.findMany({
      where: {
        id: { in: payload.testCaseIds },
        projectId: project.id,
      },
      select: {
        id: true,
        title: true,
        displayId: true,
      },
    });

    if (!testCases.length) {
      return NextResponse.json({ error: "No matching test cases found." }, { status: 400 });
    }

    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        createdById: session.user.id,
        name: payload.name,
        source: "MANUAL",
        status: "IN_PROGRESS",
        results: {
          create: testCases.map((testCase) => ({
            testCaseId: testCase.id,
            name: `${testCase.displayId} · ${testCase.title}`,
            status: "BLOCKED",
          })),
        },
      },
    });

    return NextResponse.json({ runId: run.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid manual run payload.", issues: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Unable to create manual run." }, { status: 500 });
  }
}
