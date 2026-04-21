import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess } from "@/lib/projects";

const createSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  testCaseIds: z.array(z.string()).default([]),
});

// ─── GET /api/test-suites ─────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedProjectId = searchParams.get("projectId");

  const project = requestedProjectId
    ? { id: requestedProjectId }
    : await ensureProjectForUser(session.user.id);

  if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userHasProjectAccess(session.user.id, project.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const suites = await db.testSuite.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: {
      cases: {
        orderBy: { order: "asc" },
        include: {
          testCase: {
            select: {
              id: true,
              title: true,
              priority: true,
              status: true,
              displayId: true,
              jiraKey: true,
              module: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ suites, projectId: project.id });
}

// ─── POST /api/test-suites ────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = createSchema.parse(await request.json());
    const project = payload.projectId
      ? { id: payload.projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await userHasProjectAccess(session.user.id, project.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (payload.testCaseIds.length > 0) {
      const count = await db.testCase.count({
        where: { id: { in: payload.testCaseIds }, projectId: project.id },
      });
      if (count !== payload.testCaseIds.length) {
        return NextResponse.json(
          { error: "One or more test case IDs do not belong to this project." },
          { status: 422 }
        );
      }
    }

    const suite = await db.testSuite.create({
      data: {
        projectId: project.id,
        name: payload.name,
        description: payload.description,
        cases: {
          create: payload.testCaseIds.map((tcId, i) => ({
            testCaseId: tcId,
            order: i,
            addedById: session.user.id,
          })),
        },
      },
      include: {
        cases: {
          orderBy: { order: "asc" },
          include: {
            testCase: {
              select: {
                id: true,
                title: true,
                priority: true,
                status: true,
                displayId: true,
                jiraKey: true,
                module: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ suite }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A suite with this name already exists in this project." },
        { status: 409 }
      );
    }
    console.error("[POST /api/test-suites]", error);
    return NextResponse.json({ error: "Unable to create test suite." }, { status: 500 });
  }
}
