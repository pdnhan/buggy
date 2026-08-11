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
    testSuite: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    apiKey: { update: vi.fn() },
  },
}));

vi.mock("@/lib/api-formatters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-formatters")>("@/lib/api-formatters");
  return { ...actual, fetchSuiteWithCases: vi.fn(), formatSuiteWithCases: actual.formatSuiteWithCases };
});

import { GET, PATCH, DELETE } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { fetchSuiteWithCases } from "@/lib/api-formatters";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockFetchSuite = fetchSuiteWithCases as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testSuite: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  apiKey: { update: ReturnType<typeof vi.fn> };
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(method: string, body?: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-suites/s1", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function params() {
  return { params: Promise.resolve({ id: "s1" }) };
}

const suiteWithCases = { id: "s1", name: "Smoke", description: null, createdAt: new Date(), cases: [] };

describe("GET /api/v1/test-suites/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeRequest("GET", undefined, ""), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the suite is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(404);
  });

  it("returns the suite with its cases", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_suite.name).toBe("Smoke");
  });

  it("scopes the findFirst lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue(suiteWithCases);
    await GET(makeRequest("GET"), params());
    expect(mockDb.testSuite.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", projectId: "real-project" },
    });
  });
});

describe("PATCH /api/v1/test-suites/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await PATCH(makeRequest("PATCH", { name: "New" }), params());
    expect(res.status).toBe(403);
  });

  it("returns 404 when the suite is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { name: "New" }), params());
    expect(res.status).toBe(404);
  });

  it("updates the suite and returns it", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue({ ...suiteWithCases, name: "Renamed" });
    const res = await PATCH(makeRequest("PATCH", { name: "Renamed" }), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_suite.name).toBe("Renamed");
  });
});

describe("DELETE /api/v1/test-suites/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await DELETE(makeRequest("DELETE"), params());
    expect(res.status).toBe(403);
  });

  it("deletes the suite and returns deleted:true", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findFirst.mockResolvedValue({ id: "s1" });
    const res = await DELETE(makeRequest("DELETE"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
  });
});
