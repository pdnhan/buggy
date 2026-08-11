import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess } from "@/lib/projects";
import { MetricsPanel } from "@/components/metrics-panel";
import { calculateFlakiness, TestHistoryItem } from "@/lib/flaky-detection";
import { getProjectMetrics } from "@/lib/metrics";
import { ResultStatus } from "@prisma/client";

export default async function MetricsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { projectId } = await params;

  if (!(await userHasProjectAccess(session.user.id, projectId))) {
    notFound();
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) notFound();

  // CQ-112: this page used to re-implement getProjectMetrics()'s entire
  // calculation inline (defect report percentages, defect density, average
  // run duration) instead of calling it — and the copy had already diverged
  // (this page rounded to 1 decimal, the lib didn't), so the dashboard and
  // the public v1 /api/v1/metrics endpoint could report different numbers
  // for the same project. getProjectMetrics is now the single
  // implementation; this page only adds what's specific to IT (flakiness,
  // which comes from a different source — automated TestRun history — and
  // the total test case count).
  const {
    testCoverage,
    ddp,
    escapedDefects,
    defectLeakage,
    defectDensity,
    avgTimeToConfidenceMs,
    latestReport: latest,
    history,
  } = await getProjectMetrics(projectId);

  const automatedRuns = await db.testRun.findMany({
    where: { projectId, source: "AUTOMATED" },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { results: { select: { name: true, status: true } } },
  });

  const testHistories = new Map<string, TestHistoryItem[]>();
  for (const run of automatedRuns) {
    for (const result of run.results) {
      const history = testHistories.get(result.name) ?? [];
      history.push({ status: result.status as ResultStatus });
      testHistories.set(result.name, history);
    }
  }

  const allFlaky = [...testHistories.entries()]
    .map(([name, history]) => {
      const flakiness = calculateFlakiness(history);
      return {
        name,
        score: Math.round(flakiness.score * 100),
        failureRate: Math.round(flakiness.failureRate * 100),
        isFlaky: flakiness.isFlaky,
      };
    })
    .filter((f) => f.isFlaky)
    .sort((a, b) => b.score - a.score);

  const flakinessIndex =
    allFlaky.length > 0
      ? Math.round((allFlaky.reduce((sum, f) => sum + f.score, 0) / allFlaky.length) * 10) / 10
      : 0;

  const testCaseCount = await db.testCase.count({ where: { projectId } });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <MetricsPanel
        projectId={project.id}
        projectName={project.name}
        metrics={{
          testCoverage,
          ddp,
          escapedDefects,
          defectLeakage,
          defectDensity,
          avgTimeToConfidenceMs,
          flakinessIndex,
          topFlakyTests: allFlaky.slice(0, 5),
        }}
        history={history}
        latestReport={
          latest
            ? {
                requirementsCovered: latest.requirementsCovered,
                totalRequirements: latest.totalRequirements,
                testingBugsFound: latest.testingBugsFound,
                productionBugsFound: latest.productionBugsFound,
                notes: latest.notes ?? undefined,
                reportedAt: latest.reportedAt.toISOString(),
              }
            : null
        }
        testCaseCount={testCaseCount}
      />
    </main>
  );
}
