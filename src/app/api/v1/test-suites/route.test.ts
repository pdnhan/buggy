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
    testSuite: { findMany: vi.fn(), create: vi.fn() },
    testCase: { count: vi.fn() },
    apiKey: { update: vi.fn() },
  },
}));

vi.mock("@/lib/api-formatters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-formatters")>("@/lib/api-formatters");
  return { ...actual, fetchSuiteWithCases: vi.fn(), formatSuiteWithCases: actual.formatSuiteWithCases };
});

import { GET, POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { fetchSuiteWithCases } from "@/lib/api-formatters";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockFetchSuite = fetchSuiteWithCases as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testSuite: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  testCase: { count: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeGetRequest(query = "", token = "valid-key") {
  return new Request(`http://localhost/api/v1/test-suites?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-suites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/test-suites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeGetRequest("", ""));
    expect(res.status).toBe(401);
  });

  it("scopes the findMany call to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testSuite.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.testSuite.findMany.mock.calls[0][0].where.projectId).toBe("real-project");
  });

  it("returns the suite list for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findMany.mockResolvedValue([
      { id: "s1", name: "Smoke", description: null, createdAt: new Date(), _count: { cases: 3 } },
    ]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_suites).toHaveLength(1);
    expect(data.test_suites[0].case_count).toBe(3);
    expect(data.has_next_page).toBe(false);
    expect(data.next_cursor).toBeNull();
  });

  it("applies the default limit (50) when none is supplied", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    // Route requests one extra row to detect a next page, so `take` is limit+1.
    expect(mockDb.testSuite.findMany.mock.calls[0][0].take).toBe(51);
    expect(mockDb.testSuite.findMany.mock.calls[0][0].cursor).toBeUndefined();
  });

  it("honors an explicit limit and clamps it at 200 in the Prisma call", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=5"));
    expect(mockDb.testSuite.findMany.mock.calls[0][0].take).toBe(6);

    mockDb.testSuite.findMany.mockClear();
    await GET(makeGetRequest("limit=99999"));
    expect(mockDb.testSuite.findMany.mock.calls[0][0].take).toBe(201);
  });

  it("returns 400 for a non-numeric limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=abc"));
    expect(res.status).toBe(400);
    expect(mockDb.testSuite.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative, zero, or non-integer limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);

    for (const bad of ["-1", "0", "2.5"]) {
      const res = await GET(makeGetRequest(`limit=${bad}`));
      expect(res.status).toBe(400);
    }
    expect(mockDb.testSuite.findMany).not.toHaveBeenCalled();
  });

  it("advances the cursor and reports next_cursor when a page overflows", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const page = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      name: `Suite ${i}`,
      description: null,
      createdAt: new Date(),
      _count: { cases: 0 },
    }));
    mockDb.testSuite.findMany.mockResolvedValue(page); // limit=2 requested -> take 3 -> overflow
    const res = await GET(makeGetRequest("limit=2"));
    const data = await res.json();
    expect(data.has_next_page).toBe(true);
    expect(data.test_suites).toHaveLength(2);
    expect(data.next_cursor).toBe("s1");
  });

  it("uses the supplied cursor for the following page", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=2&cursor=s1"));
    const call = mockDb.testSuite.findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: "s1" });
    expect(call.skip).toBe(1);
  });

  it("the returned next_cursor actually fetches the next page", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const firstPage = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      name: `Suite ${i}`,
      description: null,
      createdAt: new Date(),
      _count: { cases: 0 },
    }));
    mockDb.testSuite.findMany.mockResolvedValueOnce(firstPage);
    const firstRes = await GET(makeGetRequest("limit=2"));
    const firstData = await firstRes.json();
    expect(firstData.next_cursor).toBe("s1");

    mockDb.testSuite.findMany.mockResolvedValueOnce([
      { id: "s2", name: "Suite 2", description: null, createdAt: new Date(), _count: { cases: 0 } },
    ]);
    const secondRes = await GET(makeGetRequest(`limit=2&cursor=${firstData.next_cursor}`));
    const secondData = await secondRes.json();
    expect(secondData.test_suites.map((s: { id: string }) => s.id)).toEqual(["s2"]);
    expect(secondData.has_next_page).toBe(false);

    const secondCall = mockDb.testSuite.findMany.mock.calls[1][0];
    expect(secondCall.cursor).toEqual({ id: "s1" });
  });
});

describe("POST /api/v1/test-suites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makePostRequest({ name: "New Suite" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an empty name", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makePostRequest({ name: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 422 when a test_case_id does not belong to the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.count.mockResolvedValue(1);
    const res = await POST(
      makePostRequest({ name: "New Suite", test_case_ids: ["tc-a", "tc-b"] })
    );
    expect(res.status).toBe(422);
  });

  it("creates a suite and returns 201", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testSuite.create.mockResolvedValue({ id: "s1" });
    mockFetchSuite.mockResolvedValue({
      id: "s1",
      name: "New Suite",
      description: null,
      createdAt: new Date(),
      cases: [],
    });
    const res = await POST(makePostRequest({ name: "New Suite" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.test_suite.name).toBe("New Suite");
  });
});
