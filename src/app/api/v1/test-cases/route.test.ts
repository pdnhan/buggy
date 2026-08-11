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
    testCase: { findMany: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { GET, POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: { findMany: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeGetRequest(query = "", token = "valid-key") {
  return new Request(`http://localhost/api/v1/test-cases?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-cases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/test-cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(makeGetRequest("", ""));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the API key does not resolve", async () => {
    mockResolveApiKey.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("scopes the findMany call to the key's project, not a caller-supplied one", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testCase.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("projectId=attacker-project"));
    const call = mockDb.testCase.findMany.mock.calls[0][0];
    expect(call.where.projectId).toBe("real-project");
  });

  it("returns the paginated test case list for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findMany.mockResolvedValue([
      {
        id: "tc-1",
        displayId: "TC-0001",
        title: "Login works",
        description: null,
        preconditions: null,
        expectedResult: null,
        tags: [],
        priority: "MEDIUM",
        status: "ACTIVE",
        jiraKey: null,
        createdAt: new Date(),
        module: null,
      },
    ]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_cases).toHaveLength(1);
    expect(data.has_next_page).toBe(false);
    expect(data.project_id).toBe("p1");
  });

  it("caps the limit at 200 and reports next_cursor when a page overflows", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const page = Array.from({ length: 3 }, (_, i) => ({
      id: `tc-${i}`,
      displayId: `TC-000${i}`,
      title: "x",
      description: null,
      preconditions: null,
      expectedResult: null,
      tags: [],
      priority: "MEDIUM",
      status: "ACTIVE",
      jiraKey: null,
      createdAt: new Date(),
      module: null,
    }));
    mockDb.testCase.findMany.mockResolvedValue(page); // limit=2 requested -> take 3 -> hasNextPage
    const res = await GET(makeGetRequest("limit=2"));
    const data = await res.json();
    expect(data.has_next_page).toBe(true);
    expect(data.test_cases).toHaveLength(2);
    expect(data.next_cursor).toBe("tc-1");
  });

  it("clamps an out-of-range limit to 200 in the actual Prisma call", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=99999"));
    // Route requests one extra row to detect a next page, so `take` is limit+1.
    expect(mockDb.testCase.findMany.mock.calls[0][0].take).toBe(201);
  });

  // CQ-106: Number("abc") is NaN, which used to reach Prisma as `take`
  // (a 500) instead of a clear validation error.
  it("returns 400 for a non-numeric limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=abc"));
    expect(res.status).toBe(400);
    expect(mockDb.testCase.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=-1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a zero limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=0"));
    expect(res.status).toBe(400);
  });

  it("applies the default limit (100) when absent", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.testCase.findMany.mock.calls[0][0].take).toBe(101);
  });

  it("passes a valid limit through as `take`", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=5"));
    expect(mockDb.testCase.findMany.mock.calls[0][0].take).toBe(6);
  });
});

describe("POST /api/v1/test-cases", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockTransaction() {
    const tx = {
      module: { upsert: vi.fn() },
      project: { update: vi.fn().mockResolvedValue({ testCaseCounter: 1, testCasePrefix: "TC" }) },
      testCase: {
        create: vi.fn().mockResolvedValue({
          id: "tc-1",
          displayId: "TC-0001",
          title: "New case",
          description: null,
          preconditions: null,
          expectedResult: null,
          tags: [],
          priority: "MEDIUM",
          status: "DRAFT",
          jiraKey: null,
          createdAt: new Date(),
          module: null,
        }),
      },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    return tx;
  }

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await POST(makePostRequest({ title: "x" }, ""));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the API key does not resolve", async () => {
    mockResolveApiKey.mockResolvedValue(null);
    const res = await POST(makePostRequest({ title: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makePostRequest({ title: "x" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for a payload missing the required title", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  it("creates a test case and returns 201", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockTransaction();
    const res = await POST(makePostRequest({ title: "New case" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.test_case.display_id).toBe("TC-0001");
  });
});
