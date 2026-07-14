import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bug: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  getProjectRole: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockGetRole = getProjectRole as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1" } };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/bugs/bug1/reopen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: "bug1" }) };
}

describe("POST /api/bugs/[id]/reopen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing reason", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await POST(makeRequest({}), params());
    expect(res.status).toBe(400);
  });

  it("returns 404 when the bug does not exist", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(404);
  });

  it("returns 403 for a VIEWER", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue({ id: "bug1", projectId: "p1", status: "FIXED" });
    mockGetRole.mockResolvedValue("VIEWER");
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(403);
  });

  it("returns 400 when the bug has never been fixed, resolved, or closed", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue({ id: "bug1", projectId: "p1", status: "OPEN" });
    mockGetRole.mockResolvedValue("MEMBER");
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(400);
  });

  it("creates the first reopen event with sequence number 1", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue({
      id: "bug1",
      projectId: "p1",
      status: "FIXED",
      firstReopenedDate: null,
    });
    mockGetRole.mockResolvedValue("MEMBER");

    const tx = {
      reopenEvent: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNumber: null } }),
        create: vi.fn().mockResolvedValue({ id: "re1", sequenceNumber: 1 }),
      },
      bug: {
        update: vi.fn().mockResolvedValue({ id: "bug1", status: "REOPENED", reopenCount: 1 }),
      },
      auditLog: { create: vi.fn() },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(201);
    expect(tx.reopenEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.reopenEvent.create.mock.calls[0][0].data.sequenceNumber).toBe(1);
    expect(tx.bug.update.mock.calls[0][0].data.reopenCount).toBe(1);
    expect(tx.bug.update.mock.calls[0][0].data.status).toBe("REOPENED");
  });

  it("increments the sequence number for a subsequent reopen", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue({
      id: "bug1",
      projectId: "p1",
      status: "CLOSED",
      firstReopenedDate: new Date("2026-01-01"),
    });
    mockGetRole.mockResolvedValue("ADMIN");

    const tx = {
      reopenEvent: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNumber: 1 } }),
        create: vi.fn().mockResolvedValue({ id: "re2", sequenceNumber: 2 }),
      },
      bug: {
        update: vi.fn().mockResolvedValue({ id: "bug1", status: "REOPENED", reopenCount: 2 }),
      },
      auditLog: { create: vi.fn() },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const res = await POST(makeRequest({ reason: "PARTIAL_FIX" }), params());
    expect(res.status).toBe(201);
    expect(tx.reopenEvent.create.mock.calls[0][0].data.sequenceNumber).toBe(2);
    expect(tx.bug.update.mock.calls[0][0].data.reopenCount).toBe(2);
  });
});
