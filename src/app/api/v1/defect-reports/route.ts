import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { parseLimitParam } from "@/lib/api-pagination";

const createReportSchema = z.object({
  requirementsCovered: z.number().int().min(0),
  totalRequirements: z.number().int().min(0),
  testingBugsFound: z.number().int().min(0),
  productionBugsFound: z.number().int().min(0),
  notes: z.string().max(2000).optional(),
});

function formatReport(report: {
  id: string;
  reportedAt: Date;
  requirementsCovered: number;
  totalRequirements: number;
  testingBugsFound: number;
  productionBugsFound: number;
  notes: string | null;
}) {
  return {
    id: report.id,
    reported_at: report.reportedAt.toISOString(),
    requirements_covered: report.requirementsCovered,
    total_requirements: report.totalRequirements,
    testing_bugs_found: report.testingBugsFound,
    production_bugs_found: report.productionBugsFound,
    notes: report.notes,
  };
}

// ─── GET /api/v1/defect-reports ────────────────────────────────────────────────

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitResult = parseLimitParam(searchParams, 20, 100);
  if (limitResult.error) return limitResult.error;
  const limit = limitResult.limit;

  const reports = await db.defectReport.findMany({
    where: { projectId: apiKey.projectId },
    orderBy: { reportedAt: "desc" },
    take: limit,
  });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  return NextResponse.json({
    defect_reports: reports.map(formatReport),
    project_id: apiKey.projectId,
  });
}

// ─── POST /api/v1/defect-reports ──────────────────────────────────────────────

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  try {
    const payload = createReportSchema.parse(await request.json());

    const report = await db.defectReport.create({
      data: {
        projectId: apiKey.projectId,
        requirementsCovered: payload.requirementsCovered,
        totalRequirements: payload.totalRequirements,
        testingBugsFound: payload.testingBugsFound,
        productionBugsFound: payload.productionBugsFound,
        notes: payload.notes,
      },
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json({ defect_report: formatReport(report) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid payload.", issues: error.issues },
        { status: 400 }
      );
    }
    console.error("[POST /api/v1/defect-reports]", error);
    return NextResponse.json({ error: "Unable to create defect report." }, { status: 500 });
  }
}
