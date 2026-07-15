import { notFound, redirect } from "next/navigation";
import { startOfMonth, endOfMonth, subMonths, format, parse } from "date-fns";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess } from "@/lib/projects";
import { getFeatureFlags } from "@/lib/feature-flags";
import { QualityPanel } from "@/components/quality-panel";
import {
  calculateMonthlyKpis,
  evaluateKpiStatus,
  DEFAULT_KPI_TARGETS,
  type BugKpiInput,
} from "@/lib/bug-tracking";
import type { BugSeverity, Prisma } from "@prisma/client";

export const DATE_BASIS_OPTIONS = ["created", "detected", "reopened", "closed"] as const;
export type DateBasis = (typeof DATE_BASIS_OPTIONS)[number];

function dateBasisWhere(basis: DateBasis, start: Date, end: Date): Prisma.BugWhereInput {
  const range = { gte: start, lte: end };
  switch (basis) {
    case "detected":
      return { firstDetectedDate: range };
    case "reopened":
      return { lastReopenedDate: range };
    case "closed":
      return { closedDate: range };
    default:
      return { createdAt: range };
  }
}

const bugKpiSelect = {
  severity: true,
  priority: true,
  detectionPhase: true,
  detectionSource: true,
  isLeaked: true,
  reopenCount: true,
} satisfies Prisma.BugSelect;

export default async function QualityDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string; dateBasis?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { projectId } = await params;
  if (!(await userHasProjectAccess(session.user.id, projectId))) notFound();

  const flags = await getFeatureFlags();
  if (!flags.enableBugTracking) notFound();

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const sp = await searchParams;
  const monthParam = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : format(new Date(), "yyyy-MM");
  const dateBasis: DateBasis = (DATE_BASIS_OPTIONS as readonly string[]).includes(sp.dateBasis ?? "")
    ? (sp.dateBasis as DateBasis)
    : "created";

  const monthDate = parse(monthParam, "yyyy-MM", new Date());
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  const currentMonthBugs: BugKpiInput[] = await db.bug.findMany({
    where: { projectId, ...dateBasisWhere(dateBasis, monthStart, monthEnd) },
    select: bugKpiSelect,
  });

  const kpis = calculateMonthlyKpis(currentMonthBugs);

  const criticalProductionBugs = await db.bug.count({
    where: {
      projectId,
      severity: "CRITICAL",
      detectionPhase: "PRODUCTION",
      ...dateBasisWhere(dateBasis, monthStart, monthEnd),
    },
  });

  const trendMonths = Array.from({ length: 6 }, (_, i) => subMonths(monthDate, 5 - i));
  const trend = await Promise.all(
    trendMonths.map(async (m) => {
      const start = startOfMonth(m);
      const end = endOfMonth(m);
      const bugs: BugKpiInput[] = await db.bug.findMany({
        where: { projectId, ...dateBasisWhere(dateBasis, start, end) },
        select: bugKpiSelect,
      });
      const monthKpis = calculateMonthlyKpis(bugs);
      return {
        month: format(m, "yyyy-MM"),
        label: format(m, "MMM yyyy"),
        qaCaughtBugs: monthKpis.qaCaughtBugs,
        uatFoundBugs: monthKpis.uatFoundBugs,
        productionLeakedBugs: monthKpis.productionLeakedBugs,
        totalLeakageRate: Math.round(monthKpis.totalLeakageRate * 10) / 10,
        productionLeakageRate: Math.round(monthKpis.productionLeakageRate * 10) / 10,
        reopenedBugs: monthKpis.reopenedBugs,
        totalReopenEvents: monthKpis.totalReopenEvents,
        avgReopensPerReopenedBug: Math.round(monthKpis.avgReopensPerReopenedBug * 100) / 100,
      };
    })
  );

  const severities: BugSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const severityDistribution = severities.map((severity) => ({
    severity,
    count: currentMonthBugs.filter((b) => b.severity === severity).length,
  }));

  const statuses = {
    qaDetectionRate: evaluateKpiStatus(
      kpis.qaDetectionRate,
      DEFAULT_KPI_TARGETS.qaDetectionRateMin,
      "min",
      kpis.totalUniqueBugs
    ),
    productionLeakageRate: evaluateKpiStatus(
      kpis.productionLeakageRate,
      DEFAULT_KPI_TARGETS.productionLeakageRateMax,
      "max",
      kpis.totalUniqueBugs
    ),
    reopenRate: evaluateKpiStatus(
      kpis.reopenRate,
      DEFAULT_KPI_TARGETS.reopenRateMax,
      "max",
      kpis.totalUniqueBugs
    ),
    avgReopensPerReopenedBug: evaluateKpiStatus(
      kpis.avgReopensPerReopenedBug,
      DEFAULT_KPI_TARGETS.avgReopensPerReopenedBugMax,
      "max",
      kpis.reopenedBugs
    ),
    criticalProductionBugs: evaluateKpiStatus(
      criticalProductionBugs,
      DEFAULT_KPI_TARGETS.criticalProductionBugsMax,
      "max",
      kpis.totalUniqueBugs
    ),
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <QualityPanel
        projectId={project.id}
        projectName={project.name}
        month={monthParam}
        dateBasis={dateBasis}
        kpis={kpis}
        criticalProductionBugs={criticalProductionBugs}
        statuses={statuses}
        targets={DEFAULT_KPI_TARGETS}
        trend={trend}
        severityDistribution={severityDistribution}
      />
    </main>
  );
}
