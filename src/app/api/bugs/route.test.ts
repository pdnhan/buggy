import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bug: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  getProjectRole: vi.fn(),
  userHasProjectAccess: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, getProjectRole, userHasProjectAccess } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockGetRole = getProjectRole as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1", email: "user1@example.com" } };

function makeGetRequest(query = "projectId=p1") {
  return new Request(`http://localhost/api/bugs?${query}`);
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/bugs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  projectId: "p1",
  title: "Checkout crashes on submit",
  severity: "HIGH",
  detectionPhase: "QA",
};

describe("GET /api/bugs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when project cannot be resolved", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue(null);
    const res = await GET(makeGetRequest(""));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks project access", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(false);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  it("returns the bug list for a valid project member", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.bug.findMany.mockResolvedValue([{ id: "b1", displayId: "BUG-0001" }]);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bugs).toHaveLength(1);
  });
});

describe("POST /api/bugs", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockTransaction(overrides: Partial<Record<string, unknown>> = {}) {
    const tx = {
      module: { upsert: vi.fn() },
      project: { update: vi.fn().mockResolvedValue({ bugCounter: 1 }) },
      bug: {
        create: vi.fn().mockResolvedValue({
          id: "bug1",
          displayId: "BUG-0001",
          severity: "HIGH",
          detectionPhase: "QA",
          isLeaked: false,
          leakageOverridden: false,
        }),
      },
      auditLog: { create: vi.fn() },
      ...overrides,
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    return tx;
  }

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a payload missing required fields", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await POST(makePostRequest({ projectId: "p1" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the user is not a project member", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue(null);
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a VIEWER attempts to create a bug", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue("VIEWER");
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a non-admin attempts a leakage override", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue("MEMBER");
    const res = await POST(
      makePostRequest({
        ...validPayload,
        leakageOverride: { isLeaked: false, reason: "found in a linked ticket" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when overriding a production bug to not-leaked", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue("ADMIN");
    const res = await POST(
      makePostRequest({
        ...validPayload,
        detectionPhase: "PRODUCTION",
        leakageOverride: { isLeaked: false, reason: "irrelevant" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates a bug and writes an audit log entry", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue("MEMBER");
    const tx = mockTransaction();

    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(201);
    expect(tx.bug.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.isLeaked).toBe(false); // QA phase is not leaked by default
    expect(createArgs.data.reporterId).toBe("user-1");
  });

  it("auto-classifies a production-detected bug as leaked", async () => {
    mockAuth.mockResolvedValue(session);
    mockGetRole.mockResolvedValue("MEMBER");
    const tx = mockTransaction();

    const res = await POST(makePostRequest({ ...validPayload, detectionPhase: "PRODUCTION" }));
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.isLeaked).toBe(true);
  });
});
