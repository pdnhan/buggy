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
    defectReport: { findMany: vi.fn(), create: vi.fn() },
    apiKey: { update: vi.fn() },
  },
}));

import { GET, POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  defectReport: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeGetRequest(query = "", token = "valid-key") {
  return new Request(`http://localhost/api/v1/defect-reports?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/defect-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/defect-reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeGetRequest("", ""));
    expect(res.status).toBe(401);
  });

  it("scopes the findMany call to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.defectReport.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.defectReport.findMany.mock.calls[0][0].where.projectId).toBe("real-project");
  });

  it("returns the report list for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.defectReport.findMany.mockResolvedValue([
      {
        id: "dr1",
        reportedAt: new Date(),
        requirementsCovered: 8,
        totalRequirements: 10,
        testingBugsFound: 3,
        productionBugsFound: 1,
        notes: null,
      },
    ]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defect_reports).toHaveLength(1);
    expect(data.defect_reports[0].requirements_covered).toBe(8);
  });

  // CQ-106: Number("abc") is NaN, which used to reach Prisma as `take`
  // (a 500) instead of a clear validation error.
  it("returns 400 for a non-numeric limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=abc"));
    expect(res.status).toBe(400);
    expect(mockDb.defectReport.findMany).not.toHaveBeenCalled();
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
    mockDb.defectReport.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.defectReport.findMany.mock.calls[0][0].take).toBe(20);
  });

  it("passes a valid limit through as `take`", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.defectReport.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=5"));
    expect(mockDb.defectReport.findMany.mock.calls[0][0].take).toBe(5);
  });
});

describe("POST /api/v1/defect-reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(
      makePostRequest({
        requirementsCovered: 5,
        totalRequirements: 10,
        testingBugsFound: 2,
        productionBugsFound: 0,
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for a payload missing required fields", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  it("creates a defect report scoped to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.defectReport.create.mockResolvedValue({
      id: "dr1",
      reportedAt: new Date(),
      requirementsCovered: 5,
      totalRequirements: 10,
      testingBugsFound: 2,
      productionBugsFound: 0,
      notes: null,
    });
    const res = await POST(
      makePostRequest({
        requirementsCovered: 5,
        totalRequirements: 10,
        testingBugsFound: 2,
        productionBugsFound: 0,
      })
    );
    expect(res.status).toBe(201);
    const createArgs = mockDb.defectReport.create.mock.calls[0][0];
    expect(createArgs.data.projectId).toBe("p1");
  });
});
