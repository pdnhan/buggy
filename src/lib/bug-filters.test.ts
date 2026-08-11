import { describe, it, expect } from "vitest";
import { buildBugWhere } from "./bug-filters";

// This is the single function responsible for scoping every bug list/export
// to a project — GET /api/bugs, GET /api/bugs/export, and GET /api/v1/bugs
// all delegate to it. It previously had no test coverage at all, which let
// the tenant-scoping invariant go unverified anywhere in the codebase.
describe("buildBugWhere", () => {
  it("always scopes by projectId, even with no query params", () => {
    const where = buildBugWhere(new URLSearchParams(), "project-1");
    expect(where.projectId).toBe("project-1");
  });

  it("scopes by the given projectId regardless of what's in the query string", () => {
    // A malicious or buggy client passing a different project id in the
    // query string must not be able to override the server-derived scope —
    // buildBugWhere takes projectId as a separate trusted argument, not
    // from searchParams, specifically to prevent this.
    const params = new URLSearchParams({ projectId: "attacker-project" });
    const where = buildBugWhere(params, "real-project");
    expect(where.projectId).toBe("real-project");
  });

  it("applies a single enum filter alongside projectId", () => {
    const params = new URLSearchParams({ severity: "CRITICAL" });
    const where = buildBugWhere(params, "p1");
    expect(where).toMatchObject({ projectId: "p1", severity: "CRITICAL" });
  });

  it("ignores an invalid enum value rather than passing it through to Prisma", () => {
    const params = new URLSearchParams({ severity: "NOT_A_REAL_SEVERITY" });
    const where = buildBugWhere(params, "p1");
    expect(where.severity).toBeUndefined();
  });

  it("filters by isLeaked=true", () => {
    const where = buildBugWhere(new URLSearchParams({ leaked: "true" }), "p1");
    expect(where.isLeaked).toBe(true);
  });

  it("filters by isLeaked=false", () => {
    const where = buildBugWhere(new URLSearchParams({ leaked: "false" }), "p1");
    expect(where.isLeaked).toBe(false);
  });

  it("filters by reopened=true as reopenCount > 0", () => {
    const where = buildBugWhere(new URLSearchParams({ reopened: "true" }), "p1");
    expect(where.reopenCount).toEqual({ gt: 0 });
  });

  it("filters by reopened=false as reopenCount === 0", () => {
    const where = buildBugWhere(new URLSearchParams({ reopened: "false" }), "p1");
    expect(where.reopenCount).toBe(0);
  });

  it("builds a date range from from/to", () => {
    const where = buildBugWhere(
      new URLSearchParams({ from: "2026-01-01", to: "2026-01-31" }),
      "p1"
    );
    expect(where.createdAt).toEqual({
      gte: new Date("2026-01-01"),
      lte: new Date("2026-01-31"),
    });
  });

  it("builds an open-ended date range with only 'from'", () => {
    const where = buildBugWhere(new URLSearchParams({ from: "2026-01-01" }), "p1");
    expect(where.createdAt).toEqual({ gte: new Date("2026-01-01") });
  });

  it("builds a case-insensitive OR search across title/description/displayId/externalIssueId", () => {
    const where = buildBugWhere(new URLSearchParams({ search: "login" }), "p1");
    expect(where.OR).toEqual([
      { title: { contains: "login", mode: "insensitive" } },
      { description: { contains: "login", mode: "insensitive" } },
      { displayId: { contains: "login", mode: "insensitive" } },
      { externalIssueId: { contains: "login", mode: "insensitive" } },
    ]);
  });

  it("combines multiple filters with projectId in a single where clause", () => {
    const params = new URLSearchParams({
      severity: "HIGH",
      status: "OPEN",
      moduleId: "mod-1",
      leaked: "true",
    });
    const where = buildBugWhere(params, "p1");
    expect(where).toMatchObject({
      projectId: "p1",
      severity: "HIGH",
      status: "OPEN",
      moduleId: "mod-1",
      isLeaked: true,
    });
  });
});
