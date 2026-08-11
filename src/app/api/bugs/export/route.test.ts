import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: vi.fn() },
    bug: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userHasProjectAccess: vi.fn(),
}));

import { GET } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  bug: { findMany: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "user-1", email: "user1@example.com" } };

function makeRequest(query = "projectId=p1") {
  return new Request(`http://localhost/api/bugs/export?${query}`);
}

function baseBug(overrides: Record<string, unknown> = {}) {
  return {
    displayId: "BUG-0001",
    externalIssueId: null,
    title: "Crash on save",
    module: null,
    severity: "HIGH",
    priority: "MEDIUM",
    status: "OPEN",
    detectionSource: "QA",
    detectionPhase: "QA",
    isLeaked: false,
    rootCause: null,
    reopenCount: 0,
    assignedDeveloper: null,
    responsibleQa: null,
    reporter: null,
    sprint: null,
    release: null,
    fixVersion: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    closedDate: null,
    ...overrides,
  };
}

describe("GET /api/bugs/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockHasAccess.mockResolvedValue(true);
    mockDb.project.findUnique.mockResolvedValue({ name: "Buggy" });
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 without project access", async () => {
    mockHasAccess.mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("emits a header row and one row per bug", async () => {
    mockDb.bug.findMany.mockResolvedValue([baseBug()]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.split("\n");
    expect(lines[4]).toBe("Bug ID,External Issue ID,Title,Module,Severity,Priority,Status,Detection Source,Detection Phase,Leaked,Root Cause,Reopen Count,Assigned Developer,Responsible QA,Reporter,Sprint,Release,Fix Version,Created At,Closed At");
    expect(lines[5]).toContain("BUG-0001");
  });

  // CQ-110: a title containing a comma/quote must not corrupt the row.
  it("escapes a bug title containing a comma and quotes", async () => {
    mockDb.bug.findMany.mockResolvedValue([baseBug({ title: 'Crash, "urgent"' })]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    expect(csv).toContain('"Crash, ""urgent"""');
  });

  // CQ-110: the old escapeCsv() missed a bare \r — a title with one used to
  // be able to break the row structure.
  it("escapes a bug title containing a bare carriage return", async () => {
    mockDb.bug.findMany.mockResolvedValue([baseBug({ title: "Crash\ron save" })]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    expect(csv).toContain('"Crash\ron save"');
  });

  // CQ-110: a title starting with a formula-trigger character must not be
  // interpretable as a formula when the CSV is opened in a spreadsheet.
  it("prefixes a bug title starting with a formula-trigger character", async () => {
    mockDb.bug.findMany.mockResolvedValue([baseBug({ title: "=CMD('/C calc')!A0" })]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    expect(csv).toContain("'=CMD('/C calc')!A0");
  });

  // CQ-110: preamble rows must route their interpolated values through
  // csvCell too, not just the header/data rows.
  it("escapes a project name in the preamble comment row", async () => {
    mockDb.project.findUnique.mockResolvedValue({ name: 'Project, "Alpha"' });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    const lines = csv.split("\n");
    // The WHOLE line (literal "# Project: " prefix included) must be one
    // validly-quoted CSV field — the quote has to open at position 0 of the
    // field, not mid-string after the literal prefix.
    expect(lines[0]).toBe('"# Project: Project, ""Alpha"""');
  });

  // CQ-110: the old `# Project: ${csvCell(name)}` shape put the opening
  // quote AFTER the literal "# Project: " prefix — not valid RFC 4180
  // quoting, since a quoted field must open at the field's first character.
  // A parser fed that malformed line would split it into extra fields (on
  // the comma) or extra records (on the newline) instead of reading it back
  // as the single field it's supposed to be. Each case below round-trips
  // the preamble's first line through a minimal RFC 4180 field parser and
  // checks it comes back as exactly one field with the expected content.
  function parseOneCsvField(line: string): string {
    if (!line.startsWith('"') || !line.endsWith('"')) {
      throw new Error(`Not a quoted field: ${line}`);
    }
    return line.slice(1, -1).replace(/""/g, '"');
  }

  it("round-trips a project name containing a comma as a single field", async () => {
    mockDb.project.findUnique.mockResolvedValue({ name: "Acme, Inc." });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    const firstLine = csv.split("\n")[0];
    expect(parseOneCsvField(firstLine)).toBe("# Project: Acme, Inc.");
  });

  it("round-trips a project name containing a double quote as a single field", async () => {
    mockDb.project.findUnique.mockResolvedValue({ name: 'Acme "The Best"' });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    const firstLine = csv.split("\n")[0];
    expect(parseOneCsvField(firstLine)).toBe('# Project: Acme "The Best"');
  });

  it("round-trips a project name containing a newline as a single field, not an extra CSV record", async () => {
    mockDb.project.findUnique.mockResolvedValue({ name: "Acme\nSecond Line" });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    // A naive split("\n") would see the embedded newline as a new line —
    // the quoted field's own content must be recoverable as ONE field
    // spanning that embedded newline, which is what makes it valid RFC 4180
    // (rather than corrupting the preamble into an extra record).
    const firstField = csv.slice(0, csv.indexOf('"', 1) + 1);
    expect(parseOneCsvField(firstField)).toBe("# Project: Acme\nSecond Line");
  });

  it("does not let a project name starting with '=' be read as a formula, even though the literal prefix comes first", async () => {
    mockDb.project.findUnique.mockResolvedValue({ name: "=CMD('/C calc')!A0" });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    const firstLine = csv.split("\n")[0];
    // The whole field's content starts with "# Project: ", not "=", so it
    // was never formula-triggering in the first place — this asserts that
    // stays true (and that the value is preserved verbatim) now that the
    // whole line goes through csvCell as one value.
    expect(firstLine).toBe("# Project: =CMD('/C calc')!A0");
  });

  // CQ-110: every preamble line, not just "# Project:", must route its
  // whole line through csvRow — this covers the "# Generated by:" line
  // (built from session.user.email).
  it("round-trips a comma-containing value in the Generated-by preamble line too", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", email: 'weird,"email"@example.com' } });
    mockDb.bug.findMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const csv = await res.text();
    const lines = csv.split("\n");
    expect(lines[3]).toBe('"# Generated by: weird,""email""@example.com"');
  });
});
