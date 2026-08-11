import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testCase: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userHasProjectAccess: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

vi.mock("@/lib/test-case-ids", () => ({
  reserveTestCaseDisplayIds: vi.fn(async () => ["TC-0001"]),
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const session = { user: { id: "user-1" } };

function makeGetRequest(projectId = "p1") {
  return new Request(`http://localhost/api/test-cases?projectId=${projectId}`);
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/test-cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/test-cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns cases for any project member (VIEWER can read)", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.testCase.findMany.mockResolvedValue([]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/test-cases", () => {
  beforeEach(() => vi.clearAllMocks());

  const validPayload = { projectId: "p1", title: "Login works" };

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
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("creates a test case for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(true);
    mockDb.$transaction.mockImplementation(async (fn) =>
      fn({
        module: { upsert: vi.fn() },
        testCase: { create: vi.fn(async () => ({ id: "tc1", title: "Login works" })) },
      })
    );
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(201);
  });
});
