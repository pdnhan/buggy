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
    testCase: { findFirst: vi.fn(), delete: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { GET, PATCH, DELETE } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: { findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(method: string, body?: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-cases/tc-1", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function params() {
  return { params: Promise.resolve({ id: "tc-1" }) };
}

const testCase = {
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
};

describe("GET /api/v1/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeRequest("GET", undefined, ""), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the case is not found in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(404);
  });

  it("returns the test case for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(testCase);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_case.display_id).toBe("TC-0001");
  });

  it("scopes the findFirst lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testCase.findFirst.mockResolvedValue(testCase);
    await GET(makeRequest("GET"), params());
    expect(mockDb.testCase.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "tc-1",
      projectId: "real-project",
    });
  });
});

describe("PATCH /api/v1/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await PATCH(makeRequest("PATCH", { title: "x" }), params());
    expect(res.status).toBe(403);
  });

  it("returns 404 when the case does not belong to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { title: "x" }), params());
    expect(res.status).toBe(404);
  });

  it("updates the test case and returns it", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(testCase);
    const tx = { testCase: { update: vi.fn().mockResolvedValue({ ...testCase, title: "Updated" }) } };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const res = await PATCH(makeRequest("PATCH", { title: "Updated" }), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.test_case.title).toBe("Updated");
  });
});

describe("DELETE /api/v1/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await DELETE(makeRequest("DELETE"), params());
    expect(res.status).toBe(403);
  });

  it("returns 404 when the case does not belong to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), params());
    expect(res.status).toBe(404);
  });

  it("deletes the case and returns deleted:true", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testCase.findFirst.mockResolvedValue(testCase);
    const res = await DELETE(makeRequest("DELETE"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(mockDb.testCase.delete).toHaveBeenCalledWith({ where: { id: "tc-1" } });
  });
});
