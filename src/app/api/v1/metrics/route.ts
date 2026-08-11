import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { getProjectMetrics } from "@/lib/metrics";

// ─── GET /api/v1/metrics ──────────────────────────────────────────────────────

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const metrics = await getProjectMetrics(apiKey.projectId);

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json(metrics);
}
