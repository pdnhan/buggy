import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";
import { autoCorrectJiraKey } from "@/lib/jira";

const jiraKeySchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .nullable()
  .transform((val) => {
    if (!val) return null;
    const { corrected } = autoCorrectJiraKey(val);
    return corrected;
  });

const updateTestCaseSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional().nullable(),
  preconditions: z.string().max(10_000).optional().nullable(),
  expectedResult: z.string().max(10_000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  moduleName: z.string().trim().min(1).max(120).optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).optional(),
  jiraKey: jiraKeySchema,
});

async function getTestCaseWithAccess(userId: string, testCaseId: string) {
  const testCase = await db.testCase.findUnique({
    where: { id: testCaseId },
    include: { module: true },
  });

  if (!testCase) return null;
  if (!(await userHasProjectAccess(userId, testCase.projectId))) return null;
  return testCase;
}

// Used by PUT/DELETE — a VIEWER can read a test case but must not mutate one.
async function getTestCaseWithWriteAccess(userId: string, testCaseId: string) {
  const testCase = await db.testCase.findUnique({
    where: { id: testCaseId },
    include: { module: true },
  });

  if (!testCase) return null;
  if (!(await userCanWriteToProject(userId, testCase.projectId))) return null;
  return testCase;
}

// ─── GET /api/test-cases/[id] ─────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const testCase = await getTestCaseWithAccess(session.user.id, id);
  if (!testCase) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ testCase });
}

// ─── PUT /api/test-cases/[id] ─────────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const payload = updateTestCaseSchema.parse(await request.json());

    const existing = await getTestCaseWithWriteAccess(session.user.id, id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let moduleId = existing.moduleId;

    if (payload.moduleName !== undefined) {
      if (payload.moduleName === null || payload.moduleName === "") {
        moduleId = null;
      } else {
        const mod = await db.module.upsert({
          where: { projectId_name: { projectId: existing.projectId, name: payload.moduleName } },
          update: {},
          create: { projectId: existing.projectId, name: payload.moduleName },
        });
        moduleId = mod.id;
      }
    }

    const updated = await db.testCase.update({
      where: { id },
      data: {
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.description !== undefined && { description: payload.description }),
        ...(payload.preconditions !== undefined && { preconditions: payload.preconditions }),
        ...(payload.expectedResult !== undefined && { expectedResult: payload.expectedResult }),
        ...(payload.tags !== undefined && { tags: payload.tags }),
        ...(payload.priority !== undefined && { priority: payload.priority }),
        ...(payload.status !== undefined && { status: payload.status }),
        ...(payload.jiraKey !== undefined && { jiraKey: payload.jiraKey ?? null }),
        moduleId,
      },
      include: { module: true },
    });

    return NextResponse.json({ testCase: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[PUT /api/test-cases/[id]]", error);
    return NextResponse.json({ error: "Unable to update test case." }, { status: 500 });
  }
}

// ─── DELETE /api/test-cases/[id] ──────────────────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const testCase = await getTestCaseWithWriteAccess(session.user.id, id);
  if (!testCase) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.testCase.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
