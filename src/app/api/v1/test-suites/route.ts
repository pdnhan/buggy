import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { fetchSuiteWithCases, formatSuiteWithCases } from "@/lib/api-formatters";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  test_case_ids: z.array(z.string().min(1)).default([]),
});

// Mirrors the pagination bounds already advertised by the MCP `list_test_suites`
// tool (limit: min 1, max 200, default 50) — see mcp-server/src/tools/test-suites.ts.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;

  const rawLimit = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "limit must be a positive integer." },
        { status: 400 }
      );
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const suites = await db.testSuite.findMany({
    where: { projectId: apiKey.projectId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { _count: { select: { cases: true } } },
  });

  const hasNextPage = suites.length > limit;
  const page = hasNextPage ? suites.slice(0, limit) : suites;
  const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null;

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({
    test_suites: page.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      case_count: s._count.cases,
      created_at: s.createdAt,
    })),
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

  let payload: z.infer<typeof createSchema>;
  try {
    payload = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create test suite." }, { status: 500 });
  }

  // Cross-project ownership check
  if (payload.test_case_ids.length > 0) {
    const count = await db.testCase.count({
      where: { id: { in: payload.test_case_ids }, projectId: apiKey.projectId },
    });
    if (count !== payload.test_case_ids.length) {
      return NextResponse.json(
        { error: "One or more test case IDs do not belong to this project." },
        { status: 422 }
      );
    }
  }

  try {
    const suite = await db.testSuite.create({
      data: {
        projectId: apiKey.projectId,
        name: payload.name,
        description: payload.description,
        cases: payload.test_case_ids.length > 0
          ? {
              createMany: {
                data: payload.test_case_ids.map((tcId, i) => ({
                  testCaseId: tcId,
                  order: i,
                })),
                skipDuplicates: true,
              },
            }
          : undefined,
      },
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    const full = await fetchSuiteWithCases(suite.id);
    return NextResponse.json({ test_suite: formatSuiteWithCases(full!) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create test suite." }, { status: 500 });
  }
}
