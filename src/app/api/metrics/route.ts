import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";
import { getProjectMetrics } from "@/lib/metrics";

const createReportSchema = z.object({
  projectId: z.string().min(1).optional(),
  requirementsCovered: z.number().int().min(0),
  totalRequirements: z.number().int().min(0),
  testingBugsFound: z.number().int().min(0),
  productionBugsFound: z.number().int().min(0),
  notes: z.string().max(2000).optional(),
});

// ─── GET /api/metrics ─────────────────────────────────────────────────────────
// Returns computed metrics for a project, combining TestResult data with
// the latest manual DefectReport entry.

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

  const metrics = await getProjectMetrics(project.id);
  return NextResponse.json(metrics);
}

// ─── POST /api/metrics — log a new defect report ─────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = createReportSchema.parse(await request.json());
    const project = payload.projectId
      ? { id: payload.projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await userCanWriteToProject(session.user.id, project.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const report = await db.defectReport.create({
      data: {
        projectId: project.id,
        requirementsCovered: payload.requirementsCovered,
        totalRequirements: payload.totalRequirements,
        testingBugsFound: payload.testingBugsFound,
        productionBugsFound: payload.productionBugsFound,
        notes: payload.notes,
      },
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
    }
    console.error("[POST /api/metrics]", error);
    return NextResponse.json({ error: "Unable to save report." }, { status: 500 });
  }
}
