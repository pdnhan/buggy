import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testRun: { findUnique: vi.fn(), update: vi.fn() },
    testResult: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userCanWriteToProject: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testRun: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  testResult: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

const session = { user: { id: "user-1" } };
const run = { id: "run1", projectId: "p1", source: "MANUAL" };

function makeParams() {
  return { params: Promise.resolve({ runId: "run1", resultId: "result1" }) };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/manual-runs/run1/results/result1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/manual-runs/[runId]/results/[resultId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(false);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.testResult.update).not.toHaveBeenCalled();
  });

  it("updates the result for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([{ status: "PASSED" }]);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(200);
  });

  // ─── status/notes independence (the headline change this route got) ──────

  it("status-only: updates status and does not touch notes", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([{ status: "PASSED" }]);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDb.testResult.update).toHaveBeenCalledWith({
      where: { id: "result1" },
      data: { status: "PASSED" },
    });
  });

  it("notes-only: persists notes and does NOT change status (client saves notes independently of status)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([{ status: "PASSED" }]);
    const res = await PATCH(makeRequest({ notes: "Repro steps: click twice" }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDb.testResult.update).toHaveBeenCalledWith({
      where: { id: "result1" },
      data: { notes: "Repro steps: click twice" },
    });
    // No `status` key at all in the update payload — not even undefined
    // overwriting a real value, since a spread of `undefined` is omitted.
    expect(mockDb.testResult.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it("status and notes together: persists both in the same update", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([{ status: "FAILED" }]);
    const res = await PATCH(
      makeRequest({ status: "FAILED", notes: "Broken on staging" }),
      makeParams()
    );
    expect(res.status).toBe(200);
    expect(mockDb.testResult.update).toHaveBeenCalledWith({
      where: { id: "result1" },
      data: { status: "FAILED", notes: "Broken on staging" },
    });
  });

  it("rejects a body with neither status nor notes (400, .refine())", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    const res = await PATCH(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
    expect(mockDb.testResult.update).not.toHaveBeenCalled();
  });

  // ─── run-status transition: BLOCKED results keep the run IN_PROGRESS ─────

  it("does NOT complete the run when another result is still BLOCKED", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([
      { status: "PASSED" },
      { status: "BLOCKED" },
    ]);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDb.testRun.update).not.toHaveBeenCalled();
  });

  it("completes the run once no result remains BLOCKED", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testRun.findUnique.mockResolvedValue(run);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testResult.findFirst.mockResolvedValue({ id: "result1" });
    mockDb.testResult.update.mockResolvedValue({});
    mockDb.testResult.findMany.mockResolvedValue([{ status: "PASSED" }, { status: "FAILED" }]);
    const res = await PATCH(makeRequest({ status: "PASSED" }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDb.testRun.update).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: {
        status: "COMPLETED",
        completedAt: expect.any(Date),
      },
    });
  });
});
