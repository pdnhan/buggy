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
    testRun: { findFirst: vi.fn() },
    apiKey: { update: vi.fn() },
  },
}));

import { GET } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testRun: { findFirst: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };

function makeRequest(token = "valid-key") {
  return new Request("http://localhost/api/v1/runs/r1", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function params() {
  return { params: Promise.resolve({ id: "r1" }) };
}

describe("GET /api/v1/runs/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeRequest(""), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the run is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  it("returns the run with a results summary", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.findFirst.mockResolvedValue({
      id: "r1",
      name: "Nightly",
      source: "AUTOMATED",
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      results: [
        { id: "res1", name: "t1", suite: null, status: "PASSED", durationMs: 10, failureMessage: null, category: null },
        { id: "res2", name: "t2", suite: null, status: "FAILED", durationMs: 20, failureMessage: "boom", category: "ASSERTION" },
      ],
    });
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.total).toBe(2);
    expect(data.summary.passed).toBe(1);
    expect(data.summary.failed).toBe(1);
  });

  it("scopes the findFirst lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testRun.findFirst.mockResolvedValue({
      id: "r1",
      name: "Nightly",
      source: "AUTOMATED",
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      results: [],
    });
    await GET(makeRequest(), params());
    expect(mockDb.testRun.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "r1",
      projectId: "real-project",
    });
  });
});
