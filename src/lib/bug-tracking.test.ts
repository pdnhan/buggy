import { describe, it, expect } from "vitest";
import {
  isPhaseLeaked,
  isPhaseQaCaught,
  canReopen,
  requiresRootCauseBeforeClosure,
  nextReopenSequenceNumber,
  calculateMonthlyKpis,
  evaluateKpiStatus,
  resolveLeakage,
  type BugKpiInput,
} from "./bug-tracking";

describe("isPhaseLeaked", () => {
  it("classifies production as leaked", () => {
    expect(isPhaseLeaked("PRODUCTION")).toBe(true);
  });
  it("classifies UAT and client acceptance as leaked", () => {
    expect(isPhaseLeaked("UAT")).toBe(true);
    expect(isPhaseLeaked("CLIENT_ACCEPTANCE")).toBe(true);
  });
  it("classifies QA, staging, regression as not leaked", () => {
    expect(isPhaseLeaked("QA")).toBe(false);
    expect(isPhaseLeaked("STAGING")).toBe(false);
    expect(isPhaseLeaked("REGRESSION_TESTING")).toBe(false);
    expect(isPhaseLeaked("DEVELOPMENT")).toBe(false);
  });
  it("respects a custom leaked-phase configuration", () => {
    expect(isPhaseLeaked("STAGING", ["STAGING"])).toBe(true);
    expect(isPhaseLeaked("PRODUCTION", ["STAGING"])).toBe(false);
  });
});

describe("isPhaseQaCaught", () => {
  it("classifies QA, regression, staging as QA-caught by default", () => {
    expect(isPhaseQaCaught("QA")).toBe(true);
    expect(isPhaseQaCaught("REGRESSION_TESTING")).toBe(true);
    expect(isPhaseQaCaught("STAGING")).toBe(true);
  });
  it("does not classify UAT or production as QA-caught", () => {
    expect(isPhaseQaCaught("UAT")).toBe(false);
    expect(isPhaseQaCaught("PRODUCTION")).toBe(false);
  });
});

describe("canReopen", () => {
  it("allows reopening from FIXED, RESOLVED, CLOSED", () => {
    expect(canReopen("FIXED")).toBe(true);
    expect(canReopen("RESOLVED")).toBe(true);
    expect(canReopen("CLOSED")).toBe(true);
  });
  it("disallows reopening from OPEN or IN_PROGRESS", () => {
    expect(canReopen("OPEN")).toBe(false);
    expect(canReopen("IN_PROGRESS")).toBe(false);
  });
});

describe("requiresRootCauseBeforeClosure", () => {
  it("requires root cause for critical bugs", () => {
    expect(
      requiresRootCauseBeforeClosure({ severity: "CRITICAL", isLeaked: false, reopenCount: 0 })
    ).toBe(true);
  });
  it("requires root cause for high severity bugs", () => {
    expect(
      requiresRootCauseBeforeClosure({ severity: "HIGH", isLeaked: false, reopenCount: 0 })
    ).toBe(true);
  });
  it("requires root cause for leaked bugs", () => {
    expect(
      requiresRootCauseBeforeClosure({ severity: "LOW", isLeaked: true, reopenCount: 0 })
    ).toBe(true);
  });
  it("requires root cause for reopened bugs", () => {
    expect(
      requiresRootCauseBeforeClosure({ severity: "LOW", isLeaked: false, reopenCount: 1 })
    ).toBe(true);
  });
  it("does not require root cause for a plain low-severity, non-leaked, never-reopened bug", () => {
    expect(
      requiresRootCauseBeforeClosure({ severity: "MEDIUM", isLeaked: false, reopenCount: 0 })
    ).toBe(false);
  });
});

describe("nextReopenSequenceNumber", () => {
  it("returns 1 for the first reopen", () => {
    expect(nextReopenSequenceNumber([])).toBe(1);
  });
  it("increments from the highest existing sequence number", () => {
    expect(nextReopenSequenceNumber([1])).toBe(2);
    expect(nextReopenSequenceNumber([1, 2])).toBe(3);
  });
});

function bug(overrides: Partial<BugKpiInput> = {}): BugKpiInput {
  return {
    severity: "MEDIUM",
    priority: "MEDIUM",
    detectionPhase: "QA",
    detectionSource: "QA",
    isLeaked: false,
    reopenCount: 0,
    ...overrides,
  };
}

describe("calculateMonthlyKpis", () => {
  it("returns all zeros for an empty bug list", () => {
    const kpis = calculateMonthlyKpis([]);
    expect(kpis.totalUniqueBugs).toBe(0);
    expect(kpis.qaDetectionRate).toBe(0);
    expect(kpis.productionLeakageRate).toBe(0);
    expect(kpis.totalLeakageRate).toBe(0);
    expect(kpis.reopenRate).toBe(0);
    expect(kpis.avgReopensPerReopenedBug).toBe(0);
  });

  it("counts QA-caught, UAT-found, and production-leaked bugs separately", () => {
    const kpis = calculateMonthlyKpis([
      bug({ detectionPhase: "QA" }),
      bug({ detectionPhase: "STAGING" }),
      bug({ detectionPhase: "UAT", isLeaked: true }),
      bug({ detectionPhase: "PRODUCTION", isLeaked: true }),
    ]);
    expect(kpis.totalUniqueBugs).toBe(4);
    expect(kpis.qaCaughtBugs).toBe(2);
    expect(kpis.uatFoundBugs).toBe(1);
    expect(kpis.productionLeakedBugs).toBe(1);
    expect(kpis.totalLeakedBugs).toBe(2);
  });

  it("computes reopen aggregates correctly", () => {
    const kpis = calculateMonthlyKpis([
      bug({ reopenCount: 0 }),
      bug({ reopenCount: 2 }),
      bug({ reopenCount: 1 }),
    ]);
    expect(kpis.reopenedBugs).toBe(2);
    expect(kpis.totalReopenEvents).toBe(3);
    expect(kpis.avgReopensPerReopenedBug).toBe(1.5);
    expect(kpis.reopenRate).toBeCloseTo((2 / 3) * 100);
  });

  it("computes QA detection rate per the documented formula", () => {
    // 3 QA-caught, 1 leaked -> 3 / (3 + 1) * 100 = 75
    const kpis = calculateMonthlyKpis([
      bug({ detectionPhase: "QA" }),
      bug({ detectionPhase: "QA" }),
      bug({ detectionPhase: "REGRESSION_TESTING" }),
      bug({ detectionPhase: "PRODUCTION", isLeaked: true }),
    ]);
    expect(kpis.qaDetectionRate).toBeCloseTo(75);
  });

  it("excludes developer-detected bugs from QA detection rate by default", () => {
    const kpis = calculateMonthlyKpis([
      bug({ detectionPhase: "QA" }),
      bug({ detectionPhase: "PRODUCTION", isLeaked: true, detectionSource: "DEVELOPER" }),
    ]);
    // Developer-detected leaked bug excluded -> denominator only has the QA-caught bug.
    expect(kpis.qaDetectionRate).toBe(100);
  });

  it("includes developer-detected bugs when explicitly configured", () => {
    const kpis = calculateMonthlyKpis(
      [
        bug({ detectionPhase: "QA" }),
        bug({ detectionPhase: "PRODUCTION", isLeaked: true, detectionSource: "DEVELOPER" }),
      ],
      { includeDeveloperDetected: true }
    );
    expect(kpis.qaDetectionRate).toBeCloseTo(50);
  });

  it("computes production and total leakage rates", () => {
    const kpis = calculateMonthlyKpis([
      bug({ detectionPhase: "QA" }),
      bug({ detectionPhase: "UAT", isLeaked: true }),
      bug({ detectionPhase: "PRODUCTION", isLeaked: true }),
      bug({ detectionPhase: "PRODUCTION", isLeaked: true }),
    ]);
    expect(kpis.productionLeakageRate).toBeCloseTo(50);
    expect(kpis.totalLeakageRate).toBeCloseTo(75);
  });
});

describe("resolveLeakage", () => {
  it("auto-classifies without an override", () => {
    expect(resolveLeakage("QA", null)).toEqual({
      isLeaked: false,
      leakageOverridden: false,
      leakageOverrideReason: null,
    });
    expect(resolveLeakage("UAT", null)).toEqual({
      isLeaked: true,
      leakageOverridden: false,
      leakageOverrideReason: null,
    });
  });

  it("allows an authorized override with a reason", () => {
    const result = resolveLeakage("UAT", { isLeaked: false, reason: "Found by QA in a linked ticket" });
    expect(result.isLeaked).toBe(false);
    expect(result.leakageOverridden).toBe(true);
    expect(result.leakageOverrideReason).toBe("Found by QA in a linked ticket");
  });

  it("never allows a production bug to be overridden to not-leaked", () => {
    const result = resolveLeakage("PRODUCTION", { isLeaked: false, reason: "irrelevant" });
    expect(result.isLeaked).toBe(true);
    expect(result.leakageOverridden).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("evaluateKpiStatus", () => {
  it("returns INSUFFICIENT_DATA below the minimum sample size", () => {
    expect(evaluateKpiStatus(2, 5, "max", 1, 5)).toBe("INSUFFICIENT_DATA");
  });
  it("returns NO_TARGET when no target is configured", () => {
    expect(evaluateKpiStatus(2, null, "max", 10, 5)).toBe("NO_TARGET");
  });
  it("evaluates a max-direction target (e.g. leakage rate)", () => {
    expect(evaluateKpiStatus(3, 5, "max", 10, 5)).toBe("ON_TARGET");
    expect(evaluateKpiStatus(5.5, 5, "max", 10, 5)).toBe("WARNING");
    expect(evaluateKpiStatus(8, 5, "max", 10, 5)).toBe("OFF_TARGET");
  });
  it("evaluates a min-direction target (e.g. QA detection rate)", () => {
    expect(evaluateKpiStatus(97, 95, "min", 10, 5)).toBe("ON_TARGET");
    expect(evaluateKpiStatus(80, 95, "min", 10, 5)).toBe("WARNING");
    expect(evaluateKpiStatus(50, 95, "min", 10, 5)).toBe("OFF_TARGET");
  });
});
