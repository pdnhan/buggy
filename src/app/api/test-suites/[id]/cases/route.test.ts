import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testSuite: { findUnique: vi.fn() },
    testCase: { count: vi.fn(), updateMany: vi.fn() },
    testSuiteCase: { aggregate: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  userCanWriteToProject: vi.fn(),
}));

import { POST, DELETE } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testSuite: { findUnique: ReturnType<typeof vi.fn> };
  testCase: { count: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  testSuiteCase: {
    aggregate: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1" } };
const suite = { id: "suite-1", projectId: "p1" };

function makeParams() {
  return { params: Promise.resolve({ id: "suite-1" }) };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/test-suites/suite-1/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/test-suites/[id]/cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest({ testCaseIds: ["tc1"] }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller is a VIEWER (has access but cannot write — closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(false);
    const res = await POST(makeRequest({ testCaseIds: ["tc1"] }), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 422 and does not mutate anything when a test case belongs to another project (closes the cross-tenant write)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    // Only 1 of the 2 requested ids actually belongs to this project.
    mockDb.testCase.count.mockResolvedValue(1);

    const res = await POST(
      makeRequest({ testCaseIds: ["tc-in-project", "tc-in-other-project"] }),
      makeParams()
    );

    expect(res.status).toBe(422);
    expect(mockDb.testCase.count).toHaveBeenCalledWith({
      where: { id: { in: ["tc-in-project", "tc-in-other-project"] }, projectId: "p1" },
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  // CQ-107: listing the same id twice is a legitimate (if redundant)
  // request, not a foreign-id violation — db.testCase.count() returns the
  // count of DISTINCT matching rows, so without deduping first, a count of
  // 1 against a raw length of 2 would trip a false 422.
  it("adds the case exactly once when the same id is listed twice, not a 422", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue([{}, {}]);
    mockDb.testSuite.findUnique.mockResolvedValueOnce(suite).mockResolvedValueOnce({
      ...suite,
      cases: [],
    });

    const res = await POST(makeRequest({ testCaseIds: ["tc1", "tc1"] }), makeParams());

    expect(res.status).toBe(200);
    expect(mockDb.testCase.count).toHaveBeenCalledWith({
      where: { id: { in: ["tc1"] }, projectId: "p1" },
    });
    expect(mockDb.testCase.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tc1"] }, projectId: "p1" },
      data: { importBatchId: null },
    });
  });

  it("still returns 422 for a genuinely foreign id even alongside a duplicate", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    // "tc1" repeated dedupes to 1 unique id, plus 1 genuinely foreign id —
    // count only finds the 1 that belongs to this project.
    mockDb.testCase.count.mockResolvedValue(1);

    const res = await POST(
      makeRequest({ testCaseIds: ["tc1", "tc1", "tc-foreign"] }),
      makeParams()
    );

    expect(res.status).toBe(422);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("scopes the updateMany by the suite's project when all ids are valid", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue([{}, {}]);
    mockDb.testSuite.findUnique.mockResolvedValueOnce(suite).mockResolvedValueOnce({
      ...suite,
      cases: [],
    });

    await POST(makeRequest({ testCaseIds: ["tc1"] }), makeParams());

    // The transaction is built from db.testCase.updateMany({ where: {...} }) —
    // verify the mock call captured the projectId-scoped where clause.
    expect(mockDb.testCase.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tc1"] }, projectId: "p1" },
      data: { importBatchId: null },
    });
  });
});

describe("DELETE /api/test-suites/[id]/cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest({ testCaseIds: ["tc1"] }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller has no access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(false);
    const res = await DELETE(makeRequest({ testCaseIds: ["tc1"] }), makeParams());
    expect(res.status).toBe(404);
  });
});
