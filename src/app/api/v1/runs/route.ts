import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { categoryForStatus } from "@/lib/failure-category";
import { parseLimitParam } from "@/lib/api-pagination";

type ResultStatus = "PASSED" | "FAILED" | "SKIPPED" | "ERROR";

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Optional: when absent, the run is created under the API key's own
  // project (see POST handler below). When present, it must match the
  // key's project — this is a tenant boundary, not a convenience default.
  project_id: z.string().min(1).optional(),
  results: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        suite: z.string().trim().max(300).optional(),
        status: z.enum(["passed", "failed", "skipped", "error"]),
        duration_ms: z.number().int().nonnegative().optional(),
        failure_message: z.string().max(20_000).optional(),
        stack_trace: z.string().max(100_000).optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .min(1),
});

function mapStatus(status: "passed" | "failed" | "skipped" | "error") {
  if (status === "passed") return "PASSED" as ResultStatus;
  if (status === "failed") return "FAILED" as ResultStatus;
  if (status === "skipped") return "SKIPPED" as ResultStatus;
  return "ERROR" as ResultStatus;
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitResult = parseLimitParam(searchParams, 20, 100);
  if (limitResult.error) return limitResult.error;
  const limit = limitResult.limit;

  const runs = await db.testRun.findMany({
    where: {
      projectId: apiKey.projectId,
      ...(source ? { source: source as "AUTOMATED" | "MANUAL" } : {}),
      ...(status ? { status: status as "IN_PROGRESS" | "COMPLETED" | "ABORTED" } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { _count: { select: { results: true } } },
  });

  const hasNextPage = runs.length > limit;
  const page = hasNextPage ? runs.slice(0, limit) : runs;
  const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null;

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({
    runs: page.map((r) => ({
      run_id: r.id,
      name: r.name,
      source: r.source,
      status: r.status,
      result_count: r._count.results,
      created_at: r.startedAt,
      completed_at: r.completedAt,
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

  try {
    const payload = payloadSchema.parse(await request.json());

    // project_id is optional: when the caller omits it, default to the
    // project the API key is scoped to. When the caller does provide it,
    // it must match the key's project exactly — this 403 is a real tenant
    // boundary and must not be weakened just because the field is now
    // optional.
    if (payload.project_id !== undefined && payload.project_id !== apiKey.projectId) {
      return NextResponse.json(
        { error: "API key does not have access to this project." },
        { status: 403 }
      );
    }

    const projectId = payload.project_id ?? apiKey.projectId;

    const run = await db.testRun.create({
      data: {
        projectId,
        createdById: apiKey.userId,
        name: payload.name,
        source: "AUTOMATED",
        status: "COMPLETED",
        completedAt: new Date(),
        results: {
          create: payload.results.map((result) => {
            const mapped = mapStatus(result.status);
            return {
              name: result.name,
              suite: result.suite,
              status: mapped,
              durationMs: result.duration_ms,
              failureMessage: result.failure_message,
              stackTrace: result.stack_trace,
              metadata: result.metadata,
              category: categoryForStatus(mapped, result.failure_message, result.stack_trace),
            };
          }),
        },
      },
      include: { _count: { select: { results: true } } },
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json(
      { run_id: run.id, name: run.name, imported_results: run._count.results },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid payload.", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Unable to ingest test run." }, { status: 500 });
  }
}
