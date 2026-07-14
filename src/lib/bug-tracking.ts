import type { BugPriority, BugSeverity, BugStatus, DetectionPhase, DetectionSource } from "@prisma/client";

// ─── Configuration defaults (section 7.6 / 8.2 / 8.3 of the spec) ─────────────
// These are the system defaults. Per-project configurability is tracked as a
// follow-up (see docs/bug-quality-tracking-todo.md) — for the MVP they are
// fixed constants shared by the leakage classifier, KPI calculator, and UI.

export const DEFAULT_LEAKED_PHASES: DetectionPhase[] = ["UAT", "CLIENT_ACCEPTANCE", "PRODUCTION"];

export const DEFAULT_QA_CAUGHT_PHASES: DetectionPhase[] = ["QA", "REGRESSION_TESTING", "STAGING"];

export const TERMINAL_STATUSES: BugStatus[] = ["CLOSED", "REJECTED", "DUPLICATE", "CANNOT_REPRODUCE"];

// Statuses a bug must currently be in before it is eligible to be reopened (rule 18.9).
export const REOPENABLE_FROM_STATUSES: BugStatus[] = ["FIXED", "RESOLVED", "CLOSED"];

export const ROOT_CAUSE_REQUIRED_SEVERITIES: BugSeverity[] = ["CRITICAL", "HIGH"];

export const DEFAULT_KPI_TARGETS = {
  qaDetectionRateMin: 95,
  productionLeakageRateMax: 5,
  criticalProductionBugsMax: 0,
  reopenRateMax: 10,
  avgReopensPerReopenedBugMax: 1.3,
};

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

// ─── Leakage classification (section 7.6) ──────────────────────────────────────

export function isPhaseLeaked(
  phase: DetectionPhase,
  leakedPhases: DetectionPhase[] = DEFAULT_LEAKED_PHASES
): boolean {
  return leakedPhases.includes(phase);
}

export type LeakageOverride = { isLeaked: boolean; reason: string };

export type LeakageResolution = {
  isLeaked: boolean;
  leakageOverridden: boolean;
  leakageOverrideReason: string | null;
  error?: string;
};

// Production-detected bugs must always be leaked (rule 18.5) — this cannot be
// overridden even by an authorized user.
export function resolveLeakage(
  detectionPhase: DetectionPhase,
  override: LeakageOverride | null | undefined,
  leakedPhases: DetectionPhase[] = DEFAULT_LEAKED_PHASES
): LeakageResolution {
  const autoLeaked = isPhaseLeaked(detectionPhase, leakedPhases);

  if (!override) {
    return { isLeaked: autoLeaked, leakageOverridden: false, leakageOverrideReason: null };
  }

  if (detectionPhase === "PRODUCTION" && !override.isLeaked) {
    return {
      isLeaked: true,
      leakageOverridden: false,
      leakageOverrideReason: null,
      error: "Production bugs must always be classified as leaked and cannot be overridden.",
    };
  }

  return { isLeaked: override.isLeaked, leakageOverridden: true, leakageOverrideReason: override.reason };
}

export function isPhaseQaCaught(
  phase: DetectionPhase,
  qaCaughtPhases: DetectionPhase[] = DEFAULT_QA_CAUGHT_PHASES
): boolean {
  return qaCaughtPhases.includes(phase);
}

// ─── Validation helpers (section 18) ───────────────────────────────────────────

export function canReopen(currentStatus: BugStatus): boolean {
  return REOPENABLE_FROM_STATUSES.includes(currentStatus);
}

export function requiresRootCauseBeforeClosure(bug: {
  severity: BugSeverity;
  isLeaked: boolean;
  reopenCount: number;
}): boolean {
  return (
    ROOT_CAUSE_REQUIRED_SEVERITIES.includes(bug.severity) || bug.isLeaked || bug.reopenCount > 0
  );
}

export function nextReopenSequenceNumber(existingSequenceNumbers: number[]): number {
  return existingSequenceNumbers.length === 0 ? 1 : Math.max(...existingSequenceNumbers) + 1;
}

// ─── Monthly KPI calculation (section 8.2) ─────────────────────────────────────

export type BugKpiInput = {
  severity: BugSeverity;
  priority?: BugPriority;
  detectionPhase: DetectionPhase;
  detectionSource: DetectionSource;
  isLeaked: boolean;
  reopenCount: number;
};

export type MonthlyKpis = {
  totalUniqueBugs: number;
  qaCaughtBugs: number;
  uatFoundBugs: number;
  productionLeakedBugs: number;
  totalLeakedBugs: number;
  criticalBugs: number;
  highSeverityBugs: number;
  reopenedBugs: number;
  totalReopenEvents: number;
  avgReopensPerReopenedBug: number;
  qaDetectionRate: number;
  productionLeakageRate: number;
  totalLeakageRate: number;
  reopenRate: number;
};

export function calculateMonthlyKpis(
  bugs: BugKpiInput[],
  options: {
    qaCaughtPhases?: DetectionPhase[];
    includeDeveloperDetected?: boolean;
  } = {}
): MonthlyKpis {
  const qaCaughtPhases = options.qaCaughtPhases ?? DEFAULT_QA_CAUGHT_PHASES;
  const includeDeveloperDetected = options.includeDeveloperDetected ?? false;

  const totalUniqueBugs = bugs.length;
  const qaCaughtBugs = bugs.filter((b) => isPhaseQaCaught(b.detectionPhase, qaCaughtPhases)).length;
  const uatFoundBugs = bugs.filter((b) => b.detectionPhase === "UAT").length;
  const productionLeakedBugs = bugs.filter((b) => b.detectionPhase === "PRODUCTION").length;
  const totalLeakedBugs = bugs.filter((b) => b.isLeaked).length;
  const criticalBugs = bugs.filter((b) => b.severity === "CRITICAL").length;
  const highSeverityBugs = bugs.filter((b) => b.severity === "HIGH").length;
  const reopenedBugs = bugs.filter((b) => b.reopenCount > 0).length;
  const totalReopenEvents = bugs.reduce((sum, b) => sum + b.reopenCount, 0);

  // QA detection rate excludes developer-detected bugs by default (section 8.2).
  const detectionRatePool = includeDeveloperDetected
    ? bugs
    : bugs.filter((b) => b.detectionSource !== "DEVELOPER");
  const detectionRateQaCaught = detectionRatePool.filter((b) =>
    isPhaseQaCaught(b.detectionPhase, qaCaughtPhases)
  ).length;
  const detectionRateLeaked = detectionRatePool.filter((b) => b.isLeaked).length;
  const detectionRateDenominator = detectionRateQaCaught + detectionRateLeaked;

  return {
    totalUniqueBugs,
    qaCaughtBugs,
    uatFoundBugs,
    productionLeakedBugs,
    totalLeakedBugs,
    criticalBugs,
    highSeverityBugs,
    reopenedBugs,
    totalReopenEvents,
    avgReopensPerReopenedBug: reopenedBugs > 0 ? totalReopenEvents / reopenedBugs : 0,
    qaDetectionRate:
      detectionRateDenominator > 0 ? (detectionRateQaCaught / detectionRateDenominator) * 100 : 0,
    productionLeakageRate: totalUniqueBugs > 0 ? (productionLeakedBugs / totalUniqueBugs) * 100 : 0,
    totalLeakageRate: totalUniqueBugs > 0 ? (totalLeakedBugs / totalUniqueBugs) * 100 : 0,
    reopenRate: totalUniqueBugs > 0 ? (reopenedBugs / totalUniqueBugs) * 100 : 0,
  };
}

// ─── KPI target status (section 8.4) ───────────────────────────────────────────

export type KpiStatus = "ON_TARGET" | "WARNING" | "OFF_TARGET" | "NO_TARGET" | "INSUFFICIENT_DATA";

// direction: "max" means the metric should stay at/below target (warn within 20% over),
// "min" means the metric should stay at/above target (warn within 20% under).
export function evaluateKpiStatus(
  value: number,
  target: number | null | undefined,
  direction: "max" | "min",
  sampleSize: number,
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE
): KpiStatus {
  if (sampleSize < minSampleSize) return "INSUFFICIENT_DATA";
  if (target === null || target === undefined) return "NO_TARGET";

  if (direction === "max") {
    if (value <= target) return "ON_TARGET";
    if (value <= target * 1.2) return "WARNING";
    return "OFF_TARGET";
  }

  if (value >= target) return "ON_TARGET";
  if (value >= target * 0.8) return "WARNING";
  return "OFF_TARGET";
}
