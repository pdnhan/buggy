import { describe, it, expect } from "vitest";
import { buildKpiCsvLines } from "./quality-panel";
import type { MonthlyKpis } from "@/lib/bug-tracking";

// CQ-110: quality-panel's CSV export must route every interpolated value
// through csvCell just like the bugs/export route does — this test exists
// so a mutant that swaps csvCell for a raw template-literal stringifier
// (dropping RFC 4180 escaping + formula-injection defense) fails here
// instead of only being caught on the unrelated bugs/export path.

const kpis: MonthlyKpis = {
  totalUniqueBugs: 12,
  qaCaughtBugs: 8,
  uatFoundBugs: 3,
  productionLeakedBugs: 1,
  totalLeakedBugs: 4,
  criticalBugs: 2,
  highSeverityBugs: 5,
  reopenedBugs: 2,
  totalReopenEvents: 3,
  avgReopensPerReopenedBug: 1.5,
  qaDetectionRate: 66.666,
  productionLeakageRate: 8.333,
  totalLeakageRate: 33.333,
  reopenRate: 16.666,
};

const baseProps = {
  projectId: "proj_1",
  projectName: "Acme Test Project",
  month: "2026-07",
  dateBasis: "created" as const,
  kpis,
  criticalProductionBugs: 1,
  statuses: {
    qaDetectionRate: "ON_TARGET" as const,
    productionLeakageRate: "ON_TARGET" as const,
    reopenRate: "ON_TARGET" as const,
    avgReopensPerReopenedBug: "ON_TARGET" as const,
    criticalProductionBugs: "ON_TARGET" as const,
  },
  targets: {
    qaDetectionRateMin: 80,
    productionLeakageRateMax: 10,
    reopenRateMax: 15,
    avgReopensPerReopenedBugMax: 2,
    criticalProductionBugsMax: 0,
  },
  trend: [],
  severityDistribution: [],
};

const fixedNow = new Date("2026-07-15T12:00:00.000Z");

describe("buildKpiCsvLines", () => {
  it("routes the project name and every KPI value through csvCell (RFC 4180 + formula-injection escaping)", () => {
    const lines = buildKpiCsvLines(
      { ...baseProps, projectName: '=CMD("/C calc")!A0' },
      fixedNow
    );
    const projectLine = lines.find((l) => l.startsWith("Project,"));
    // A raw stringifier would emit the formula unescaped; csvCell prefixes
    // it with a single quote so spreadsheet software renders literal text
    // (and, since the value also contains double quotes, RFC 4180 quoting
    // wraps and doubles them too).
    expect(projectLine).toBe(`Project,"'=CMD(""/C calc"")!A0"`);
  });

  it("quotes a project name containing a comma (structural escaping)", () => {
    const lines = buildKpiCsvLines({ ...baseProps, projectName: "Acme, Inc." }, fixedNow);
    expect(lines.find((l) => l.startsWith("Project,"))).toBe('Project,"Acme, Inc."');
  });

  it("emits the expected header rows and KPI values in order", () => {
    const lines = buildKpiCsvLines(baseProps, fixedNow);
    expect(lines[0]).toBe("Project,Acme Test Project");
    expect(lines[1]).toBe("Reporting month,2026-07");
    expect(lines[2]).toBe("Date basis,Bug creation date");
    expect(lines[3]).toBe("Export date,2026-07-15T12:00:00.000Z");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("KPI,Value");
    expect(lines[6]).toBe("Total unique bugs,12");
    expect(lines).toContain("QA-caught bugs,8");
    expect(lines).toContain("UAT-found bugs,3");
    expect(lines).toContain("Production-leaked bugs,1");
    expect(lines).toContain("Total leaked bugs,4");
    expect(lines).toContain("Critical bugs,2");
    expect(lines).toContain("High-severity bugs,5");
    expect(lines).toContain("Critical production bugs,1");
    expect(lines).toContain("Reopened bugs,2");
    expect(lines).toContain("Total reopen events,3");
    // Rounded to 1 decimal by round1() before formatting.
    expect(lines).toContain("Average reopens per reopened bug,1.5");
    expect(lines).toContain("QA detection rate (%),66.7");
    expect(lines).toContain("Production leakage rate (%),8.3");
    expect(lines).toContain("Total leakage rate (%),33.3");
    expect(lines).toContain("Reopen rate (%),16.7");
  });
});
