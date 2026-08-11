import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testCase: { findMany: vi.fn() },
    testRun: { create: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: { findMany: ReturnType<typeof vi.fn> };
  testRun: { create: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "user-1" } };
const validPayload = { projectId: "p1", name: "Sprint run", testCaseIds: ["tc1"] };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/manual-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/manual-runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(false);
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(403);
    expect(mockDb.testRun.create).not.toHaveBeenCalled();
  });

  it("creates a manual run for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(true);
    mockDb.testCase.findMany.mockResolvedValue([{ id: "tc1", title: "Login", displayId: "TC-0001" }]);
    mockDb.testRun.create.mockResolvedValue({ id: "run1" });
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);
  });
});
