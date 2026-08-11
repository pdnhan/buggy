import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testCase: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userHasProjectAccess: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

import { GET, PUT, DELETE } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess, userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const session = { user: { id: "user-1" } };
const testCase = { id: "tc1", projectId: "p1", moduleId: null, title: "Login works" };

function makeParams() {
  return { params: Promise.resolve({ id: "tc1" }) };
}

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/test-cases/tc1", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the case for any project member (VIEWER can read)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testCase.findUnique.mockResolvedValue(testCase);
    mockHasAccess.mockResolvedValue(true);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PUT(makeRequest("PUT", { title: "New title" }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testCase.findUnique.mockResolvedValue(testCase);
    mockCanWrite.mockResolvedValue(false);
    const res = await PUT(makeRequest("PUT", { title: "New title" }), makeParams());
    expect(res.status).toBe(404);
    expect(mockDb.testCase.update).not.toHaveBeenCalled();
  });

  it("updates the case for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testCase.findUnique.mockResolvedValue(testCase);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testCase.update.mockResolvedValue({ ...testCase, title: "New title" });
    const res = await PUT(makeRequest("PUT", { title: "New title" }), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/test-cases/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testCase.findUnique.mockResolvedValue(testCase);
    mockCanWrite.mockResolvedValue(false);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(404);
    expect(mockDb.testCase.delete).not.toHaveBeenCalled();
  });

  it("deletes the case for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testCase.findUnique.mockResolvedValue(testCase);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testCase.delete.mockResolvedValue(testCase);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(200);
  });
});
