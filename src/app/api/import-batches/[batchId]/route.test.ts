import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    importBatch: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    testCase: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  userCanWriteToProject: vi.fn(),
}));

import { PATCH, DELETE } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  importBatch: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  testCase: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1" } };
const batch = { id: "batch1", projectId: "p1" };

function makeParams() {
  return { params: Promise.resolve({ batchId: "batch1" }) };
}

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/import-batches/batch1", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("PATCH /api/import-batches/[batchId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { dismissed: true }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.importBatch.findUnique.mockResolvedValue(batch);
    mockCanWrite.mockResolvedValue(false);
    const res = await PATCH(makeRequest("PATCH", { dismissed: true }), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.importBatch.update).not.toHaveBeenCalled();
  });

  it("dismisses the batch for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.importBatch.findUnique.mockResolvedValue(batch);
    mockCanWrite.mockResolvedValue(true);
    mockDb.importBatch.update.mockResolvedValue({ ...batch, dismissed: true });
    const res = await PATCH(makeRequest("PATCH", { dismissed: true }), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/import-batches/[batchId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.importBatch.findUnique.mockResolvedValue(batch);
    mockCanWrite.mockResolvedValue(false);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the batch and its cases for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.importBatch.findUnique.mockResolvedValue(batch);
    mockCanWrite.mockResolvedValue(true);
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({
        testCase: { deleteMany: vi.fn(async () => ({ count: 2 })) },
        importBatch: { delete: vi.fn(async () => batch) },
      })
    );
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(200);
  });
});
