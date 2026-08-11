import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  db: {
    defectReport: { findMany: vi.fn() },
    testResult: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { getProjectMetrics } from "./metrics";
import { db } from "./db";

const mockDb = db as unknown as {
  defectReport: { findMany: ReturnType<typeof vi.fn> };
  testResult: { groupBy: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    projectId: "p1",
    requirementsCovered: 8,
    totalRequirements: 10,
    testingBugsFound: 7,
    productionBugsFound: 3,
    notes: null,
    reportedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getProjectMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.testResult.groupBy.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([{ avg_ms: null }]);
  });

  it("returns nulls with no defect reports logged", async () => {
    mockDb.defectReport.findMany.mockResolvedValue([]);
    const metrics = await getProjectMetrics("p1");
    expect(metrics.testCoverage).toBeNull();
    expect(metrics.ddp).toBeNull();
    expect(metrics.escapedDefects).toBeNull();
    expect(metrics.defectLeakage).toBeNull();
    expect(metrics.latestReport).toBeNull();
    expect(metrics.history).toEqual([]);
  });

  it("computes testCoverage and ddp from the latest report, rounded to 1 decimal", async () => {
    // 8/10 = 80% exactly; 7/(7+3) = 70% exactly — pick non-round numbers too.
    mockDb.defectReport.findMany.mockResolvedValue([
      report({ requirementsCovered: 1, totalRequirements: 3, testingBugsFound: 2, productionBugsFound: 1 }),
    ]);
    const metrics = await getProjectMetrics("p1");
    // 1/3 * 100 = 33.333... -> round1 -> 33.3
    expect(metrics.testCoverage).toBe(33.3);
    // 2/3 * 100 = 66.666... -> round1 -> 66.7
    expect(metrics.ddp).toBe(66.7);
    expect(metrics.escapedDefects).toBe(1);
    expect(metrics.defectLeakage).toBe(1);
  });

  it("treats a report with zero totalRequirements/bugs as null testCoverage/ddp, not a divide-by-zero", async () => {
    mockDb.defectReport.findMany.mockResolvedValue([
      report({ requirementsCovered: 0, totalRequirements: 0, testingBugsFound: 0, productionBugsFound: 0 }),
    ]);
    const metrics = await getProjectMetrics("p1");
    expect(metrics.testCoverage).toBeNull();
    expect(metrics.ddp).toBeNull();
    expect(metrics.escapedDefects).toBe(0);
  });

  it("builds defectDensity from a groupBy, mapping a null suite to 'No module', sorted by count desc", async () => {
    mockDb.defectReport.findMany.mockResolvedValue([]);
    mockDb.testResult.groupBy.mockResolvedValue([
      { suite: "Checkout", _count: { _all: 3 } },
      { suite: null, _count: { _all: 7 } },
      { suite: "Login", _count: { _all: 5 } },
    ]);
    const metrics = await getProjectMetrics("p1");
    expect(metrics.defectDensity).toEqual([
      { module: "No module", count: 7 },
      { module: "Login", count: 5 },
      { module: "Checkout", count: 3 },
    ]);
    expect(mockDb.testResult.groupBy).toHaveBeenCalledWith({
      by: ["suite"],
      where: { run: { projectId: "p1" }, status: { in: ["FAILED", "ERROR"] } },
      _count: { _all: true },
    });
  });

  it("reads avgTimeToConfidenceMs from the raw SQL aggregation and rounds it", async () => {
    mockDb.defectReport.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([{ avg_ms: "1500000.7" }]);
    const metrics = await getProjectMetrics("p1");
    expect(metrics.avgTimeToConfidenceMs).toBe(1500001);
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns null avgTimeToConfidenceMs when there are no matching completed runs", async () => {
    mockDb.defectReport.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([{ avg_ms: null }]);
    const metrics = await getProjectMetrics("p1");
    expect(metrics.avgTimeToConfidenceMs).toBeNull();
  });

  it("builds a chronological (oldest-first) history array, rounded to 1 decimal, without mutating report order elsewhere", async () => {
    const newest = report({
      id: "newest",
      reportedAt: new Date("2026-02-01T00:00:00.000Z"),
      requirementsCovered: 1,
      totalRequirements: 3,
    });
    const oldest = report({
      id: "oldest",
      reportedAt: new Date("2026-01-01T00:00:00.000Z"),
      requirementsCovered: 2,
      totalRequirements: 3,
    });
    // findMany is orderBy reportedAt desc, so newest comes first from the DB.
    mockDb.defectReport.findMany.mockResolvedValue([newest, oldest]);

    const metrics = await getProjectMetrics("p1");

    expect(metrics.latestReport).toEqual(newest);
    expect(metrics.history).toHaveLength(2);
    expect(metrics.history[0].date).toBe(oldest.reportedAt.toISOString());
    expect(metrics.history[1].date).toBe(newest.reportedAt.toISOString());
    // 2/3 * 100 = 66.666... -> 66.7
    expect(metrics.history[0].testCoverage).toBe(66.7);
    // 1/3 * 100 = 33.333... -> 33.3
    expect(metrics.history[1].testCoverage).toBe(33.3);
  });
});
