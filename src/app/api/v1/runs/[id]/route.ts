import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { id } = await params;

  const run = await db.testRun.findFirst({
    where: { id, projectId: apiKey.projectId },
    include: { results: { orderBy: { createdAt: "asc" } } },
  });

  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  const summary = run.results.reduce(
    (acc, r) => {
      const key = r.status.toLowerCase() as keyof typeof acc;
      acc[key] = (acc[key] ?? 0) + 1;
      acc.total += 1;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, error: 0, blocked: 0 }
  );

  return NextResponse.json({
    run_id: run.id,
    name: run.name,
    source: run.source,
    status: run.status,
    created_at: run.startedAt,
    completed_at: run.completedAt,
    results: run.results.map((r) => ({
      id: r.id,
      name: r.name,
      suite: r.suite,
      status: r.status,
      duration_ms: r.durationMs,
      failure_message: r.failureMessage,
      category: r.category,
    })),
    summary,
  });
}
