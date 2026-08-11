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
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/test-cases/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/test-cases/bulk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await POST(makeRequest({ test_cases: [{ title: "x" }] }, ""));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makeRequest({ test_cases: [{ title: "x" }] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when test_cases is not an array", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makeRequest({ test_cases: "nope" }));
    expect(res.status).toBe(400);
  });

  it("returns 422 for an empty test_cases array", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makeRequest({ test_cases: [] }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for more than 100 test cases", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const many = Array.from({ length: 101 }, (_, i) => ({ title: `case ${i}` }));
    const res = await POST(makeRequest({ test_cases: many }));
    expect(res.status).toBe(422);
  });

  it("creates all cases and returns 201", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = {
      project: { update: vi.fn().mockResolvedValue({ testCaseCounter: 2, testCasePrefix: "TC" }) },
      module: { upsert: vi.fn() },
      testCase: {
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: "tc-1", displayId: "TC-0001", title: "a", priority: "MEDIUM", status: "DRAFT", createdAt: new Date() },
          { id: "tc-2", displayId: "TC-0002", title: "b", priority: "MEDIUM", status: "DRAFT", createdAt: new Date() },
        ]),
      },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const res = await POST(makeRequest({ test_cases: [{ title: "a" }, { title: "b" }] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.created).toBe(2);
    expect(data.test_cases).toHaveLength(2);
  });
});
