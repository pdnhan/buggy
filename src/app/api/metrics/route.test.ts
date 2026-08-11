import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    defectReport: { create: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userHasProjectAccess: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

vi.mock("@/lib/metrics", () => ({
  getProjectMetrics: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";
import { getProjectMetrics } from "@/lib/metrics";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockGetMetrics = getProjectMetrics as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as { defectReport: { create: ReturnType<typeof vi.fn> } };

const session = { user: { id: "user-1" } };

function makeGetRequest(projectId = "p1") {
  return new Request(`http://localhost/api/metrics?projectId=${projectId}`);
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/metrics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns metrics for any project member (VIEWER can read)", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockGetMetrics.mockResolvedValue({ testCoverage: 0 });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
  });

  // Cross-tenant read gate: ?projectId=<other tenant> must be blocked by
  // userHasProjectAccess before getProjectMetrics ever runs.
  it("returns 403 when the user has no access to the requested project", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(false);
    const res = await GET(makeGetRequest("other-tenant-project"));
    expect(res.status).toBe(403);
    expect(mockHasAccess).toHaveBeenCalledWith("user-1", "other-tenant-project");
    expect(mockGetMetrics).not.toHaveBeenCalled();
  });
});

describe("POST /api/metrics", () => {
  beforeEach(() => vi.clearAllMocks());

  const validPayload = {
    projectId: "p1",
    requirementsCovered: 5,
    totalRequirements: 10,
    testingBugsFound: 2,
    productionBugsFound: 0,
  };

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(false);
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(403);
    expect(mockDb.defectReport.create).not.toHaveBeenCalled();
  });

  it("creates a defect report for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(true);
    mockDb.defectReport.create.mockResolvedValue({ id: "dr1" });
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(201);
  });
});
