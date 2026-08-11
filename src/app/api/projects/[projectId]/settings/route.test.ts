import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { update: vi.fn() },
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
const mockDb = db as unknown as { project: { update: ReturnType<typeof vi.fn> } };

const session = { user: { id: "user-1" } };

function makeParams() {
  return { params: Promise.resolve({ projectId: "p1" }) };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/projects/p1/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/projects/[projectId]/settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ name: "New Name" }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockCanWrite.mockResolvedValue(false);
    const res = await PATCH(makeRequest({ name: "New Name" }), makeParams());
    expect(res.status).toBe(403);
    expect(mockDb.project.update).not.toHaveBeenCalled();
  });

  it("updates settings for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockCanWrite.mockResolvedValue(true);
    mockDb.project.update.mockResolvedValue({ id: "p1", name: "New Name" });
    const res = await PATCH(makeRequest({ name: "New Name" }), makeParams());
    expect(res.status).toBe(200);
  });
});
