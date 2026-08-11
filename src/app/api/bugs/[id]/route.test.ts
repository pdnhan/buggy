import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bug: { findUnique: vi.fn(), delete: vi.fn() },
    projectMember: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  getProjectRole: vi.fn(),
  userHasProjectAccess: vi.fn(),
}));

import { PUT } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockGetRole = getProjectRole as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findUnique: ReturnType<typeof vi.fn> };
  projectMember: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1", email: "user1@example.com" } };

const baseBug = {
  id: "b1",
  projectId: "p1",
  displayId: "BUG-0001",
  severity: "HIGH",
  priority: "MEDIUM",
  status: "OPEN",
  detectionPhase: "QA",
  isLeaked: false,
  leakageOverridden: false,
  leakageOverrideReason: null,
  rootCause: null,
  reopenCount: 0,
  moduleId: null,
  assignedDeveloperId: null,
  firstFixedDate: null,
  lastFixedDate: null,
  closedDate: null,
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/bugs/b1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: "b1" }) };
}

describe("PUT /api/bugs/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PUT(makeRequest({}), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the bug does not exist", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue(null);
    const res = await PUT(makeRequest({}), params());
    expect(res.status).toBe(404);
  });

  it("returns 403 when a VIEWER attempts to edit", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue(baseBug);
    mockGetRole.mockResolvedValue("VIEWER");
    const res = await PUT(makeRequest({ title: "Updated" }), params());
    expect(res.status).toBe(403);
  });

  // CQ-103: assignee ids must belong to the bug's project
  it("returns 422 when assignedDeveloperId is not a member of the project", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue(baseBug);
    mockGetRole.mockResolvedValue("MEMBER");
    mockDb.projectMember.findMany.mockResolvedValue([]);
    const res = await PUT(
      makeRequest({ assignedDeveloperId: "outsider-user" }),
      params()
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/must reference members of the project/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("updates the bug when assignedDeveloperId is a member of the project", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.bug.findUnique.mockResolvedValue(baseBug);
    mockGetRole.mockResolvedValue("MEMBER");
    mockDb.projectMember.findMany.mockResolvedValue([{ userId: "teammate-1" }]);
    const tx = {
      bug: {
        update: vi.fn().mockResolvedValue({
          ...baseBug,
          id: "b1",
          assignedDeveloperId: "teammate-1",
        }),
      },
      auditLog: { create: vi.fn() },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    const res = await PUT(
      makeRequest({ assignedDeveloperId: "teammate-1" }),
      params()
    );
    expect(res.status).toBe(200);
    expect(tx.bug.update).toHaveBeenCalledTimes(1);
    const updateArgs = tx.bug.update.mock.calls[0][0];
    expect(updateArgs.data.assignedDeveloperId).toBe("teammate-1");
  });
});
