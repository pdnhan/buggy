import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { formatTestCase } from "@/lib/api-formatters";

const jiraKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Z][A-Z0-9]*-[0-9]+$/, { message: "Invalid Jira issue key." })
  .transform((v) => v.toUpperCase());

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullable(),
    preconditions: z.string().max(10_000).nullable(),
    expected_result: z.string().max(10_000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    module_name: z.string().trim().min(1).max(120).nullable(),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]),
    jira_key: jiraKeySchema.nullable(),
  })
  .partial();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { id } = await params;
  const testCase = await db.testCase.findFirst({
    where: { id, projectId: apiKey.projectId },
    include: { module: true },
  });

  if (!testCase) return NextResponse.json({ error: "Test case not found." }, { status: 404 });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({ test_case: formatTestCase(testCase) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.testCase.findFirst({
    where: { id, projectId: apiKey.projectId },
  });
  if (!existing) return NextResponse.json({ error: "Test case not found." }, { status: 404 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to update test case." }, { status: 500 });
  }

  const testCase = await db.$transaction(async (tx) => {
    let moduleId: string | null | undefined = undefined;

    if ("module_name" in payload) {
      if (payload.module_name === null) {
        moduleId = null;
      } else if (payload.module_name) {
        const mod = await tx.module.upsert({
          where: {
            projectId_name: { projectId: apiKey.projectId, name: payload.module_name },
          },
          update: {},
          create: { projectId: apiKey.projectId, name: payload.module_name },
        });
        moduleId = mod.id;
      }
    }

    return tx.testCase.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.preconditions !== undefined ? { preconditions: payload.preconditions } : {}),
        ...(payload.expected_result !== undefined ? { expectedResult: payload.expected_result } : {}),
        ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.jira_key !== undefined ? { jiraKey: payload.jira_key } : {}),
        ...(moduleId !== undefined ? { moduleId } : {}),
      },
      include: { module: true },
    });
  });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({ test_case: formatTestCase(testCase) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.testCase.findFirst({
    where: { id, projectId: apiKey.projectId },
  });
  if (!existing) return NextResponse.json({ error: "Test case not found." }, { status: 404 });

  await db.testCase.delete({ where: { id } });
  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({ deleted: true });
}
