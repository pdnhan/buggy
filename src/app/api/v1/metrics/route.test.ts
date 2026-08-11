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
  },
}));

vi.mock("@/lib/metrics", () => ({
  getProjectMetrics: vi.fn(),
}));

import { GET } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { getProjectMetrics } from "@/lib/metrics";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockGetProjectMetrics = getProjectMetrics as ReturnType<typeof vi.fn>;

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };

function makeRequest(token = "valid-key") {
  return new Request("http://localhost/api/v1/metrics", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/v1/metrics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid key", async () => {
    mockResolveApiKey.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns metrics scoped to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockGetProjectMetrics.mockResolvedValue({
      projectId: "p1",
      testCoverage: 80,
      ddp: 90,
      escapedDefects: 1,
      defectLeakage: 1,
      defectDensity: [],
      avgTimeToConfidenceMs: null,
      latestReport: null,
      history: [],
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(mockGetProjectMetrics).toHaveBeenCalledWith("p1");
    expect(data.testCoverage).toBe(80);
  });
});
