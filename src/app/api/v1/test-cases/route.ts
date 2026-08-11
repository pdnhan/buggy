import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { reserveTestCaseDisplayIds } from "@/lib/test-case-ids";
import { formatTestCase } from "@/lib/api-formatters";
import { parseLimitParam } from "@/lib/api-pagination";

const jiraKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Z][A-Z0-9]*-[0-9]+$/, { message: "Invalid Jira issue key." })
  .transform((v) => v.toUpperCase());

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  preconditions: z.string().max(10_000).optional(),
  expected_result: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  module_name: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).default("DRAFT"),
  jira_key: jiraKeySchema.optional().nullable(),
});

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitResult = parseLimitParam(searchParams, 100, 200);
  if (limitResult.error) return limitResult.error;
  const limit = limitResult.limit;
  const search = searchParams.get("search")?.trim() ?? undefined;

  const testCases = await db.testCase.findMany({
    where: {
      projectId: apiKey.projectId,
      ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
    },
    include: { module: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasNextPage = testCases.length > limit;
  const page = hasNextPage ? testCases.slice(0, limit) : testCases;
  const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null;

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({
    test_cases: page.map(formatTestCase),
    next_cursor: nextCursor,
    has_next_page: hasNextPage,
    project_id: apiKey.projectId,
  });
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  try {
    const payload = createSchema.parse(await request.json());

    const testCase = await db.$transaction(async (tx) => {
      const moduleRecord = payload.module_name
        ? await tx.module.upsert({
            where: { projectId_name: { projectId: apiKey.projectId, name: payload.module_name } },
            update: {},
            create: { projectId: apiKey.projectId, name: payload.module_name },
          })
        : null;

      const [displayId] = await reserveTestCaseDisplayIds(tx, apiKey.projectId, 1);

      return tx.testCase.create({
        data: {
          projectId: apiKey.projectId,
          moduleId: moduleRecord?.id,
          displayId,
          jiraKey: payload.jira_key ?? null,
          title: payload.title,
          description: payload.description,
          preconditions: payload.preconditions,
          expectedResult: payload.expected_result,
          tags: payload.tags,
          priority: payload.priority,
          status: payload.status,
        },
        include: { module: true },
      });
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json({ test_case: formatTestCase(testCase) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create test case." }, { status: 500 });
  }
}
