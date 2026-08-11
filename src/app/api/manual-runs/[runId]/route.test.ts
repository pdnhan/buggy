import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testRun: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userHasProjectAccess: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

import { GET, PATCH } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testRun: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "user-1" } };
const run = { id: "run1", projectId: "p1", source: "MANUAL", status: "IN_PROGRESS", results: [] };

function makeParams() {
  return { params: Promise.resolve({ runId: "run1" }) };
}

function makeRequest(method: string) {
  return new Request("http://localhost/api/manual-runs/run1", { method });
}

describe("GET /api/manual-runs/[runId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the run for any project member (VIEWER can read)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockHasAccess.mockResolvedValue(true);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/manual-runs/[runId] (complete run)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH"), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue({ projectId: "p1", status: "IN_PROGRESS" });
    mockCanWrite.mockResolvedValue(false);
    const res = await PATCH(makeRequest("PATCH"), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.testRun.update).not.toHaveBeenCalled();
  });

  it("completes the run for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue({ projectId: "p1", status: "IN_PROGRESS" });
    mockCanWrite.mockResolvedValue(true);
    mockDb.testRun.update.mockResolvedValue({ id: "run1", status: "COMPLETED", completedAt: new Date() });
    const res = await PATCH(makeRequest("PATCH"), makeParams());
    expect(res.status).toBe(200);
  });
});
