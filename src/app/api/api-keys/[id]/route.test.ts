import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userCanWriteToProject: vi.fn(),
}));

import { DELETE } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  apiKey: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "user-1" } };

function makeParams() {
  return { params: Promise.resolve({ id: "key1" }) };
}

function makeRequest() {
  return new Request("http://localhost/api/api-keys/key1", { method: "DELETE" });
}

describe("DELETE /api/api-keys/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the key doesn't exist", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.apiKey.findUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.apiKey.findUnique.mockResolvedValue({ projectId: "p1" });
    mockCanWrite.mockResolvedValue(false);
    const res = await DELETE(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("deletes the key for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.apiKey.findUnique.mockResolvedValue({ projectId: "p1" });
    mockCanWrite.mockResolvedValue(true);
    mockDb.apiKey.delete.mockResolvedValue({});
    const res = await DELETE(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });
});
