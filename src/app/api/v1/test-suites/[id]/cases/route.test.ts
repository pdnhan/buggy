import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  resolveApiKey: vi.fn(),
  bearerToken: (request: Request) => {
    const auth = request.headers.get("authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    testSuite: { findFirst: vi.fn() },
    testCase: { count: vi.fn(), updateMany: vi.fn() },
    testSuiteCase: { aggregate: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/api-formatters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-formatters")>("@/lib/api-formatters");
  return { ...actual, fetchSuiteWithCases: vi.fn(), formatSuiteWithCases: actual.formatSuiteWithCases };
});

import { POST, DELETE } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { fetchSuiteWithCases } from "@/lib/api-formatters";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockFetchSuite = fetchSuiteWithCases as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testSuite: { findFirst: ReturnType<typeof vi.fn> };
  testCase: { count: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  testSuiteCase: {
    aggregate: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(method: string, body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-suites/s1/cases", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: "s1" }) };
}

const suiteWithCases = { id: "s1", name: "Smoke", description: null, createdAt: new Date(), cases: [] };

describe("POST /api/v1/test-suites/[id]/cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makeRequest("POST", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(403);
  });

  it("returns 404 when the suite does not belong to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(404);
    // Not just "findFirst returned null therefore 404" — the lookup itself
    // must be scoped by the key's project, or a suite ID that exists under
    // a DIFFERENT project would incorrectly resolve.
    expect(mockDb.testSuite.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", projectId: "p1" },
    });
  });

  // CQ-101 sibling: mirrors the scoping assertion already covered on
  // v1/test-suites/[id] and v1/test-cases/[id] — kills a mutant that drops
  // `projectId` from this lookup's `where` (cross-tenant suite mutation).
  it("scopes the suite lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue(undefined);
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    await POST(makeRequest("POST", { test_case_ids: ["tc-1"] }), params());
    expect(mockDb.testSuite.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", projectId: "real-project" },
    });
  });

  it("returns 422 when a test case does not belong to the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(0);
    const res = await POST(makeRequest("POST", { test_case_ids: ["tc-other-project"] }), params());
    expect(res.status).toBe(422);
  });

  it("adds cases and returns the updated suite", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue(undefined);
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    const res = await POST(makeRequest("POST", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_suite.id).toBe("s1");
  });

  // CQ-107: listing the same id twice is a legitimate (if redundant)
  // request, not a foreign-id violation — db.testCase.count() returns the
  // count of DISTINCT matching rows, so without deduping first, a count of
  // 1 against a raw length of 2 would trip a false 422.
  it("adds the case exactly once when the same id is listed twice, not a 422", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue(undefined);
    mockFetchSuite.mockResolvedValue(suiteWithCases);

    const res = await POST(
      makeRequest("POST", { test_case_ids: ["tc-1", "tc-1"] }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockDb.testCase.count).toHaveBeenCalledWith({
      where: { id: { in: ["tc-1"] }, projectId: "p1" },
    });
    expect(mockDb.testCase.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tc-1"] }, projectId: "p1" },
      data: { importBatchId: null },
    });
  });

  it("still returns 422 for a genuinely foreign id even alongside a duplicate", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(1);

    const res = await POST(
      makeRequest("POST", { test_case_ids: ["tc-1", "tc-1", "tc-foreign"] }),
      params()
    );

    expect(res.status).toBe(422);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  // CQ-101: the badge-clearing updateMany must be scoped to the key's
  // project too, not just the earlier ownership `count` check — keeps this
  // query safe on its own terms, matching the internal
  // src/app/api/test-suites/[id]/cases/route.ts twin.
  it("scopes the import-badge updateMany by the key's project, not just the id list", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockDb.testCase.count.mockResolvedValue(1);
    mockDb.testSuiteCase.aggregate.mockResolvedValue({ _max: { order: null } });
    mockDb.$transaction.mockResolvedValue(undefined);
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    await POST(makeRequest("POST", { test_case_ids: ["tc-1"] }), params());
    expect(mockDb.testCase.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tc-1"] }, projectId: "p1" },
      data: { importBatchId: null },
    });
  });
});

describe("DELETE /api/v1/test-suites/[id]/cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await DELETE(makeRequest("DELETE", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(403);
  });

  it("removes cases and returns the updated suite", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    const res = await DELETE(makeRequest("DELETE", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(200);
    expect(mockDb.testSuiteCase.deleteMany).toHaveBeenCalledWith({
      where: { suiteId: "s1", testCaseId: { in: ["tc-1"] } },
    });
  });

  it("returns 404 when the suite does not belong to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE", { test_case_ids: ["tc-1"] }), params());
    expect(res.status).toBe(404);
    expect(mockDb.testSuite.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", projectId: "p1" },
    });
  });

  it("scopes the suite lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    await DELETE(makeRequest("DELETE", { test_case_ids: ["tc-1"] }), params());
    expect(mockDb.testSuite.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", projectId: "real-project" },
    });
  });
});
