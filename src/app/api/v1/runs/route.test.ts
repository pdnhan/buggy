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
    testRun: { findMany: vi.fn(), create: vi.fn() },
    apiKey: { update: vi.fn() },
  },
}));

import { GET, POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testRun: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeGetRequest(query = "", token = "valid-key") {
  return new Request(`http://localhost/api/v1/runs?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeGetRequest("", ""));
    expect(res.status).toBe(401);
  });

  it("scopes the findMany call to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.testRun.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.testRun.findMany.mock.calls[0][0].where.projectId).toBe("real-project");
  });

  it("returns the run list for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.findMany.mockResolvedValue([
      {
        id: "r1",
        name: "Nightly",
        source: "AUTOMATED",
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
        _count: { results: 5 },
      },
    ]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].result_count).toBe(5);
  });

  // CQ-106: Number("abc") is NaN, which used to reach Prisma as `take`
  // (a 500) instead of a clear validation error.
  it("returns 400 for a non-numeric limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=abc"));
    expect(res.status).toBe(400);
    expect(mockDb.testRun.findMany).not.toHaveBeenCalled();
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

  it("applies the default limit (20) when absent", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.testRun.findMany.mock.calls[0][0].take).toBe(21);
  });

  it("passes a valid limit through as `take`", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=5"));
    expect(mockDb.testRun.findMany.mock.calls[0][0].take).toBe(6);
  });
});

describe("POST /api/v1/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await POST(makePostRequest({}, ""));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(
      makePostRequest({
        name: "Nightly",
        project_id: "p1",
        results: [{ name: "test 1", status: "passed" }],
      })
    );
    expect(res.status).toBe(403);
    expect(mockDb.testRun.create).not.toHaveBeenCalled();
  });

  it("returns 403 when the payload targets a different project than the key, and never writes", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(
      makePostRequest({
        name: "Nightly",
        project_id: "other-project",
        results: [{ name: "test 1", status: "passed" }],
      })
    );
    expect(res.status).toBe(403);
    expect(mockDb.testRun.create).not.toHaveBeenCalled();
  });

  it("derives the project from the API key when project_id is omitted", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "key-project" });
    mockDb.testRun.create.mockResolvedValue({
      id: "r1",
      name: "Nightly",
      _count: { results: 1 },
    });
    const res = await POST(
      makePostRequest({
        name: "Nightly",
        results: [{ name: "test 1", status: "passed" }],
      })
    );
    expect(res.status).toBe(201);
    expect(mockDb.testRun.create.mock.calls[0][0].data.projectId).toBe("key-project");
  });

  it("keeps existing behaviour when project_id matches the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.create.mockResolvedValue({
      id: "r1",
      name: "Nightly",
      _count: { results: 1 },
    });
    const res = await POST(
      makePostRequest({
        name: "Nightly",
        project_id: "p1",
        results: [{ name: "test 1", status: "passed" }],
      })
    );
    expect(res.status).toBe(201);
    expect(mockDb.testRun.create.mock.calls[0][0].data.projectId).toBe("p1");
  });

  it("returns 400 for an empty results array", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makePostRequest({ name: "Nightly", project_id: "p1", results: [] }));
    expect(res.status).toBe(400);
  });

  it("ingests a run and returns 201", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.testRun.create.mockResolvedValue({
      id: "r1",
      name: "Nightly",
      _count: { results: 1 },
    });
    const res = await POST(
      makePostRequest({
        name: "Nightly",
        project_id: "p1",
        results: [{ name: "test 1", status: "passed" }],
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported_results).toBe(1);
    expect(mockDb.testRun.create.mock.calls[0][0].data.projectId).toBe("p1");
  });
});
