import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testSuite: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
  testSuite: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const session = { user: { id: "user-1" } };
const suite = { id: "suite1", projectId: "p1", name: "Smoke Tests" };

function makeParams() {
  return { params: Promise.resolve({ id: "suite1" }) };
}

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/test-suites/suite1", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("PATCH /api/test-suites/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { name: "Renamed" }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(false);
    const res = await PATCH(makeRequest("PATCH", { name: "Renamed" }), makeParams());
    expect(res.status).toBe(404);
    expect(mockDb.testSuite.update).not.toHaveBeenCalled();
  });

  it("updates the suite for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testSuite.update.mockResolvedValue({ ...suite, name: "Renamed" });
    const res = await PATCH(makeRequest("PATCH", { name: "Renamed" }), makeParams());
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/test-suites/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a VIEWER (closes the VIEWER-write escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(false);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(404);
    expect(mockDb.testSuite.delete).not.toHaveBeenCalled();
  });

  it("deletes the suite for a member with write access", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.testSuite.findUnique.mockResolvedValue(suite);
    mockCanWrite.mockResolvedValue(true);
    mockDb.testSuite.delete.mockResolvedValue(suite);
    const res = await DELETE(makeRequest("DELETE"), makeParams());
    expect(res.status).toBe(200);
  });
});
