import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  resolveApiKey: vi.fn(),
  bearerToken: (request: Request) => {
    const auth = request.headers.get("authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    bug: { findFirst: vi.fn() },
    projectMember: { findMany: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findFirst: ReturnType<typeof vi.fn> };
  projectMember: { findMany: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/bugs/b1/reopen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: "b1" }) };
}

function mockTx() {
  const tx = {
    reopenEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNumber: null } }),
      create: vi.fn().mockResolvedValue({ id: "re-1", sequenceNumber: 1 }),
    },
    bug: {
      update: vi.fn().mockResolvedValue({
        id: "b1",
        displayId: "BUG-0001",
        title: "Crash",
        description: null,
        externalIssueId: null,
        issueTrackerUrl: null,
        severity: "HIGH",
        priority: "MEDIUM",
        bugType: null,
        rootCause: null,
        detectionSource: "QA",
        detectionPhase: "QA",
        environment: null,
        isRegression: false,
        isLeaked: false,
        sprint: null,
        release: null,
        fixVersion: null,
        module: null,
        assignedDeveloper: null,
        responsibleQa: null,
        reporter: null,
        clientImpact: null,
        businessImpact: null,
        reproductionSteps: null,
        expectedResult: null,
        actualResult: null,
        notes: null,
        labels: [],
        status: "REOPENED",
        reopenCount: 1,
        firstDetectedDate: null,
        firstReopenedDate: new Date(),
        lastReopenedDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  };
  mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
  return tx;
}

describe("POST /api/v1/bugs/[id]/reopen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }, ""), params());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(403);
  });

  it("returns 400 for a missing/invalid reason", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makeRequest({}), params());
    expect(res.status).toBe(400);
  });

  it("returns 404 when the bug is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(404);
  });

  it("rejects reopening a bug that isn't in a reopenable status", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({ id: "b1", status: "OPEN" });
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(400);
  });

  it("reopens a fixed bug, using the API key's user as reopenedBy", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      id: "b1",
      status: "FIXED",
      firstReopenedDate: null,
    });
    const tx = mockTx();
    const res = await POST(makeRequest({ reason: "FIX_DID_NOT_RESOLVE" }), params());
    expect(res.status).toBe(201);
    const createArgs = tx.reopenEvent.create.mock.calls[0][0];
    expect(createArgs.data.reopenedById).toBe("user-1");
    const data = await res.json();
    expect(data.bug.status).toBe("REOPENED");
  });

  // CQ-105: cross-tenant assignee write on bug reopen.
  it("returns 422 and performs no write when assignedDeveloperId is not a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      id: "b1",
      status: "FIXED",
      firstReopenedDate: null,
    });
    mockDb.projectMember.findMany.mockResolvedValue([]);
    const res = await POST(
      makeRequest({ reason: "FIX_DID_NOT_RESOLVE", assignedDeveloperId: "outsider-user" }),
      params()
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/must reference members of the project/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns 422 and performs no write when responsibleQaId is not a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      id: "b1",
      status: "FIXED",
      firstReopenedDate: null,
    });
    mockDb.projectMember.findMany.mockResolvedValue([]);
    const res = await POST(
      makeRequest({ reason: "FIX_DID_NOT_RESOLVE", responsibleQaId: "outsider-user" }),
      params()
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/must reference members of the project/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("reopens the bug when assignedDeveloperId/responsibleQaId are members of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      id: "b1",
      status: "FIXED",
      firstReopenedDate: null,
    });
    mockDb.projectMember.findMany.mockResolvedValue([
      { userId: "dev-1" },
      { userId: "qa-1" },
    ]);
    const tx = mockTx();
    const res = await POST(
      makeRequest({
        reason: "FIX_DID_NOT_RESOLVE",
        assignedDeveloperId: "dev-1",
        responsibleQaId: "qa-1",
      }),
      params()
    );
    expect(res.status).toBe(201);
    expect(tx.reopenEvent.create).toHaveBeenCalledTimes(1);
    const createArgs = tx.reopenEvent.create.mock.calls[0][0];
    expect(createArgs.data.assignedDeveloperId).toBe("dev-1");
    expect(createArgs.data.responsibleQaId).toBe("qa-1");
  });
});
