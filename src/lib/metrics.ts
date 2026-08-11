import { Prisma } from "@prisma/client";
import { db } from "./db";

// Single-decimal rounding for every percentage this module returns. Applied
// HERE (not by each caller) so the dashboard page and the public v1 API
// always agree on the numbers — see CQ-112: the dashboard page used to
// duplicate this entire calculation with its own rounding bolted on, while
// this function returned unrounded floats, so the same project could show
// two different DDP/coverage numbers depending on which surface you looked
// at. One decimal place matches what the dashboard already displayed to
// users, so that's the value both surfaces now converge on.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getProjectMetrics(projectId: string) {
  // ── Defect reports (manual inputs) ──────────────────────────────────────────
  const reports = await db.defectReport.findMany({
    where: { projectId },
    orderBy: { reportedAt: "desc" },
    take: 10,
  });

  const latest = reports[0] ?? null;

  // ── Test coverage ────────────────────────────────────────────────────────────
  const testCoverage =
    latest && latest.totalRequirements > 0
      ? round1((latest.requirementsCovered / latest.totalRequirements) * 100)
      : null;

  // ── DDP — Defect Detection Percentage ───────────────────────────────────────
  const totalBugs = latest
    ? latest.testingBugsFound + latest.productionBugsFound
    : 0;
  const ddp = totalBugs > 0 && latest ? round1((latest.testingBugsFound / totalBugs) * 100) : null;

  // ── Escaped defects & defect leakage ────────────────────────────────────────
  const escapedDefects = latest?.productionBugsFound ?? null;
  const defectLeakage = escapedDefects; // same metric, different framing

  // ── Defect density per module (from TestResult failures) ────────────────────
  // CQ-112: was a findMany() loading every failed TestResult row into Node
  // just to tally counts per suite in a JS loop — an unbounded read that
  // grows with the project's whole failure history. groupBy pushes the
  // tally into SQL; only one row per distinct suite comes back.
  const failedGroups = await db.testResult.groupBy({
    by: ["suite"],
    where: { run: { projectId }, status: { in: ["FAILED", "ERROR"] } },
    _count: { _all: true },
  });
  const defectDensity = failedGroups
    .map((g) => ({ module: g.suite ?? "No module", count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // ── Time to confidence: average duration of completed manual runs ─────────────
  // CQ-112: was a findMany() loading startedAt/completedAt for every
  // completed manual run and averaging them in a JS reduce(). AVG(...) in
  // SQL returns one row regardless of how many runs exist. Raw SQL is
  // needed here (not Prisma's `_avg`) because the duration isn't a stored
  // column — it's computed from two DateTime columns.
  const avgDurationRows = await db.$queryRaw<{ avg_ms: number | string | null }[]>(Prisma.sql`
    SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS avg_ms
    FROM test_runs
    WHERE "projectId" = ${projectId}
      AND status = 'COMPLETED'::"RunStatus"
      AND source = 'MANUAL'::"TestSource"
      AND "completedAt" IS NOT NULL
  `);
  const rawAvgMs = avgDurationRows[0]?.avg_ms;
  const avgTimeToConfidenceMs = rawAvgMs != null ? Math.round(Number(rawAvgMs)) : null;

  // ── Historical series for sparklines ────────────────────────────────────────
  const history = [...reports].reverse().map((r) => ({
    date: r.reportedAt.toISOString(),
    testCoverage:
      r.totalRequirements > 0 ? round1((r.requirementsCovered / r.totalRequirements) * 100) : 0,
    ddp:
      r.testingBugsFound + r.productionBugsFound > 0
        ? round1((r.testingBugsFound / (r.testingBugsFound + r.productionBugsFound)) * 100)
        : 0,
    escapedDefects: r.productionBugsFound,
    testingBugs: r.testingBugsFound,
  }));

  return {
    projectId,
    testCoverage,
    ddp,
    escapedDefects,
    defectLeakage,
    defectDensity,
    avgTimeToConfidenceMs,
    latestReport: latest,
    history,
  };
}
