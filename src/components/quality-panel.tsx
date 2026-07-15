"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import type { MonthlyKpis, KpiStatus, DEFAULT_KPI_TARGETS } from "@/lib/bug-tracking";
import type { DateBasis } from "@/app/dashboard/[projectId]/quality/page";

type TrendPoint = {
  month: string;
  label: string;
  qaCaughtBugs: number;
  uatFoundBugs: number;
  productionLeakedBugs: number;
  totalLeakageRate: number;
  productionLeakageRate: number;
  reopenedBugs: number;
  totalReopenEvents: number;
  avgReopensPerReopenedBug: number;
};

type SeverityPoint = { severity: string; count: number };

type Statuses = {
  qaDetectionRate: KpiStatus;
  productionLeakageRate: KpiStatus;
  reopenRate: KpiStatus;
  avgReopensPerReopenedBug: KpiStatus;
  criticalProductionBugs: KpiStatus;
};

type Props = {
  projectId: string;
  projectName: string;
  month: string;
  dateBasis: DateBasis;
  kpis: MonthlyKpis;
  criticalProductionBugs: number;
  statuses: Statuses;
  targets: typeof DEFAULT_KPI_TARGETS;
  trend: TrendPoint[];
  severityDistribution: SeverityPoint[];
};

const DATE_BASIS_LABELS: Record<DateBasis, string> = {
  created: "Bug creation date",
  detected: "First detection date",
  reopened: "Last reopen date",
  closed: "Closure date",
};

const STATUS_BADGE: Record<KpiStatus, { label: string; className: string }> = {
  ON_TARGET: { label: "On target", className: "border-[var(--success)] text-[var(--success)]" },
  WARNING: { label: "Warning", className: "border-[var(--warning)] text-[var(--warning-foreground)]" },
  OFF_TARGET: { label: "Off target", className: "border-destructive text-destructive" },
  NO_TARGET: { label: "No target", className: "border-border text-muted-foreground" },
  INSUFFICIENT_DATA: { label: "Insufficient data", className: "border-border text-muted-foreground" },
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function KpiCard({
  title,
  value,
  description,
  status,
}: {
  title: string;
  value: string;
  description: string;
  status?: KpiStatus;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        {status && (
          <Badge variant="outline" className={STATUS_BADGE[status].className}>
            {STATUS_BADGE[status].label}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function exportKpisToCsv(props: Props) {
  const { projectName, month, dateBasis, kpis, criticalProductionBugs } = props;
  const lines: string[] = [];
  lines.push(`Project,${projectName}`);
  lines.push(`Reporting month,${month}`);
  lines.push(`Date basis,${DATE_BASIS_LABELS[dateBasis]}`);
  lines.push(`Export date,${new Date().toISOString()}`);
  lines.push("");
  lines.push("KPI,Value");
  lines.push(`Total unique bugs,${kpis.totalUniqueBugs}`);
  lines.push(`QA-caught bugs,${kpis.qaCaughtBugs}`);
  lines.push(`UAT-found bugs,${kpis.uatFoundBugs}`);
  lines.push(`Production-leaked bugs,${kpis.productionLeakedBugs}`);
  lines.push(`Total leaked bugs,${kpis.totalLeakedBugs}`);
  lines.push(`Critical bugs,${kpis.criticalBugs}`);
  lines.push(`High-severity bugs,${kpis.highSeverityBugs}`);
  lines.push(`Critical production bugs,${criticalProductionBugs}`);
  lines.push(`Reopened bugs,${kpis.reopenedBugs}`);
  lines.push(`Total reopen events,${kpis.totalReopenEvents}`);
  lines.push(`Average reopens per reopened bug,${round1(kpis.avgReopensPerReopenedBug)}`);
  lines.push(`QA detection rate (%),${round1(kpis.qaDetectionRate)}`);
  lines.push(`Production leakage rate (%),${round1(kpis.productionLeakageRate)}`);
  lines.push(`Total leakage rate (%),${round1(kpis.totalLeakageRate)}`);
  lines.push(`Reopen rate (%),${round1(kpis.reopenRate)}`);

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bug-quality-${props.projectId}-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function QualityPanel(props: Props) {
  const { projectName, month, dateBasis, kpis, criticalProductionBugs, statuses, targets, trend, severityDistribution } =
    props;
  const router = useRouter();

  function updateQuery(next: { month?: string; dateBasis?: string }) {
    const params = new URLSearchParams({ month, dateBasis });
    if (next.month) params.set("month", next.month);
    if (next.dateBasis) params.set("dateBasis", next.dateBasis);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Monthly Quality Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {projectName} — reporting basis: {DATE_BASIS_LABELS[dateBasis]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => updateQuery({ month: e.target.value })}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            aria-label="Reporting month"
          />
          <select
            value={dateBasis}
            onChange={(e) => updateQuery({ dateBasis: e.target.value })}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            aria-label="Date basis"
          >
            {Object.entries(DATE_BASIS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={() => exportKpisToCsv(props)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Export CSV
          </button>
        </div>
      </div>

      {kpis.totalUniqueBugs === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No bugs recorded for this reporting period yet. KPIs will populate once bugs are registered.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard title="Total Unique Bugs" value={String(kpis.totalUniqueBugs)} description="Bugs created this period" />
        <KpiCard title="QA-Caught Bugs" value={String(kpis.qaCaughtBugs)} description="Found before UAT / production" />
        <KpiCard title="UAT-Found Bugs" value={String(kpis.uatFoundBugs)} description="First detected in UAT" />
        <KpiCard
          title="Production-Leaked Bugs"
          value={String(kpis.productionLeakedBugs)}
          description="First detected in production"
        />
        <KpiCard title="Total Leaked Bugs" value={String(kpis.totalLeakedBugs)} description="UAT, client, or production" />
        <KpiCard title="Critical Bugs" value={String(kpis.criticalBugs)} description="Severity: Critical" />
        <KpiCard title="High-Severity Bugs" value={String(kpis.highSeverityBugs)} description="Severity: High" />
        <KpiCard
          title="Critical Production Bugs"
          value={String(criticalProductionBugs)}
          description={`Target: ${targets.criticalProductionBugsMax}`}
          status={statuses.criticalProductionBugs}
        />
        <KpiCard title="Reopened Bugs" value={String(kpis.reopenedBugs)} description="At least one reopen event" />
        <KpiCard title="Total Reopen Events" value={String(kpis.totalReopenEvents)} description="Sum of all reopens" />
        <KpiCard
          title="Avg Reopens / Reopened Bug"
          value={round1(kpis.avgReopensPerReopenedBug).toFixed(1)}
          description={`Target: below ${targets.avgReopensPerReopenedBugMax}`}
          status={statuses.avgReopensPerReopenedBug}
        />
        <KpiCard
          title="QA Detection Rate"
          value={`${round1(kpis.qaDetectionRate)}%`}
          description={`Target: at least ${targets.qaDetectionRateMin}%`}
          status={statuses.qaDetectionRate}
        />
        <KpiCard
          title="Production Leakage Rate"
          value={`${round1(kpis.productionLeakageRate)}%`}
          description={`Target: below ${targets.productionLeakageRateMax}%`}
          status={statuses.productionLeakageRate}
        />
        <KpiCard title="Total Leakage Rate" value={`${round1(kpis.totalLeakageRate)}%`} description="All leaked / total bugs" />
        <KpiCard
          title="Reopen Rate"
          value={`${round1(kpis.reopenRate)}%`}
          description={`Target: below ${targets.reopenRateMax}%`}
          status={statuses.reopenRate}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Monthly Bug Trend</h2>
          <p className="text-xs text-muted-foreground">QA-caught, UAT-found, and production-leaked bugs by month</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="qaCaughtBugs" stackId="bugs" name="QA-caught" fill="var(--success)" />
                <Bar dataKey="uatFoundBugs" stackId="bugs" name="UAT-found" fill="var(--warning)" />
                <Bar dataKey="productionLeakedBugs" stackId="bugs" name="Production-leaked" fill="var(--destructive)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Severity Distribution</h2>
          <p className="text-xs text-muted-foreground">Bugs in this period by severity</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="severity" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" name="Bugs" fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
