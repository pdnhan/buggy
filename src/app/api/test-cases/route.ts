import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";
import { reserveTestCaseDisplayIds } from "@/lib/test-case-ids";
import { autoCorrectJiraKey } from "@/lib/jira";

// ─── Validation Schemas ───────────────────────────────────────────────────────

const jiraKeySchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .nullable()
  .transform((val) => {
    if (!val) return null;
    const { corrected } = autoCorrectJiraKey(val);
    return corrected; // null if uncorrectable
  });

const createTestCaseSchema = z.object({
  projectId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  preconditions: z.string().max(10_000).optional(),
  expectedResult: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  moduleName: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).default("DRAFT"),
  jiraKey: jiraKeySchema,
});

// ─── GET /api/test-cases ──────────────────────────────────────────────────────
// Supports cursor-based pagination for projects with up to 10 000 test cases.
// Query parameters:
//   projectId  – optional, uses the caller's default project when omitted
//   cursor     – cuid of the last item from the previous page (optional)
//   limit      – page size, 1–200, default 100
//   search     – case-insensitive title substring filter (optional)

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedProjectId = searchParams.get("projectId");
  const cursor = searchParams.get("cursor") ?? undefined;
  const rawLimit = Number(searchParams.get("limit") ?? "100");
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const search = searchParams.get("search")?.trim() ?? undefined;

  const project = requestedProjectId
    ? { id: requestedProjectId }
    : await ensureProjectForUser(session.user.id);

  if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userHasProjectAccess(session.user.id, project.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const testCases = await db.testCase.findMany({
    where: {
      projectId: project.id,
      ...(search
        ? { title: { contains: search, mode: "insensitive" } }
        : {}),
    },
    include: {
      module: true,
    },
    orderBy: { createdAt: "desc" },
    // Fetch one extra record to determine whether another page exists.
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = testCases.length > limit;
  const page = hasNextPage ? testCases.slice(0, limit) : testCases;
  const nextCursor = hasNextPage ? page[page.length - 1]?.id : undefined;

  return NextResponse.json({
    testCases: page,
    nextCursor,
    hasNextPage,
    projectId: project.id,
  });
}

// ─── POST /api/test-cases ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = createTestCaseSchema.parse(await request.json());
    const project = payload.projectId
      ? { id: payload.projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await userCanWriteToProject(session.user.id, project.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const testCase = await db.$transaction(async (tx) => {
      const moduleRecord = payload.moduleName
        ? await tx.module.upsert({
            where: {
              projectId_name: {
                projectId: project.id,
                name: payload.moduleName,
              },
            },
            update: {},
            create: {
              projectId: project.id,
              name: payload.moduleName,
            },
          })
        : null;

      const [displayId] = await reserveTestCaseDisplayIds(tx, project.id, 1);

      return tx.testCase.create({
        data: {
          projectId: project.id,
          moduleId: moduleRecord?.id,
          displayId,
          jiraKey: payload.jiraKey ?? null,
          title: payload.title,
          description: payload.description,
          preconditions: payload.preconditions,
          expectedResult: payload.expectedResult,
          tags: payload.tags,
          priority: payload.priority,
          status: payload.status,
        },
        include: {
          module: true,
        },
      });
    });

    return NextResponse.json({ testCase }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid test case payload.", issues: error.issues },
        { status: 400 }
      );
    }

    console.error("[POST /api/test-cases]", error);
    return NextResponse.json({ error: "Unable to create test case." }, { status: 500 });
  }
}
