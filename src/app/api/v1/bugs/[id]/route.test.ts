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
    module: { upsert: vi.fn() },
    projectMember: { findMany: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({
  auditLogEntry: vi.fn(),
}));

import { GET, PATCH } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { auditLogEntry } from "@/lib/audit";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockAuditLogEntry = auditLogEntry as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findFirst: ReturnType<typeof vi.fn> };
  module: { upsert: ReturnType<typeof vi.fn> };
  projectMember: { findMany: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeRequest(method: string, body?: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/bugs/b1", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function params() {
  return { params: Promise.resolve({ id: "b1" }) };
}

const baseBug = {
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
  leakageOverridden: false,
  leakageOverrideReason: null,
  sprint: null,
  release: null,
  fixVersion: null,
  moduleId: null,
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
  status: "OPEN",
  reopenCount: 0,
  firstDetectedDate: null,
  firstFixedDate: null,
  lastFixedDate: null,
  closedDate: null,
  firstReopenedDate: null,
  lastReopenedDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GET /api/v1/bugs/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeRequest("GET", undefined, ""), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the bug is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(404);
  });

  it("returns the bug for a valid key", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(baseBug);
    const res = await GET(makeRequest("GET"), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bug.display_id).toBe("BUG-0001");
  });

  it("scopes the findFirst lookup by both id and the key's project (not id alone)", async () => {
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.bug.findFirst.mockResolvedValue(baseBug);
    await GET(makeRequest("GET"), params());
    expect(mockDb.bug.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "b1",
      projectId: "real-project",
    });
  });
});

describe("PATCH /api/v1/bugs/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockTx(overrides: Partial<Record<string, unknown>> = {}) {
    const tx = {
      bug: { update: vi.fn().mockResolvedValue({ ...baseBug, ...overrides }) },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    return tx;
  }

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await PATCH(makeRequest("PATCH", { title: "x" }), params());
    expect(res.status).toBe(403);
  });

  it("returns 404 when the bug is not in the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { title: "x" }), params());
    expect(res.status).toBe(404);
  });

  it("updates fields and re-derives leakage from the (possibly new) phase", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(baseBug);
    mockTx({ detectionPhase: "PRODUCTION", isLeaked: true });
    const res = await PATCH(
      makeRequest("PATCH", { detectionPhase: "PRODUCTION" }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bug.is_leaked).toBe(true);
  });

  it("rejects closing a bug that was never fixed/resolved", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(baseBug); // firstFixedDate is null
    const res = await PATCH(makeRequest("PATCH", { status: "CLOSED" }), params());
    expect(res.status).toBe(400);
  });

  it("requires a root cause before closing a critical bug", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      ...baseBug,
      severity: "CRITICAL",
      firstFixedDate: new Date(),
      status: "RESOLVED",
    });
    const res = await PATCH(makeRequest("PATCH", { status: "CLOSED" }), params());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/root cause/i);
  });

  it("allows closing once root cause is set on a critical bug", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue({
      ...baseBug,
      severity: "CRITICAL",
      firstFixedDate: new Date(),
      status: "RESOLVED",
    });
    mockTx({ status: "CLOSED", rootCause: "HUMAN_ERROR" });
    const res = await PATCH(
      makeRequest("PATCH", { status: "CLOSED", rootCause: "HUMAN_ERROR" }),
      params()
    );
    expect(res.status).toBe(200);
  });

  // CQ-103: assignee ids must belong to the key's project
  it("returns 422 when assignedDeveloperId is not a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(baseBug);
    mockDb.projectMember.findMany.mockResolvedValue([]);
    const res = await PATCH(
      makeRequest("PATCH", { assignedDeveloperId: "outsider-user" }),
      params()
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/must reference members of the project/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("updates the bug when assignedDeveloperId is a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findFirst.mockResolvedValue(baseBug);
    mockDb.projectMember.findMany.mockResolvedValue([{ userId: "teammate-1" }]);
    const tx = mockTx({ assignedDeveloperId: "teammate-1" });
    const res = await PATCH(
      makeRequest("PATCH", { assignedDeveloperId: "teammate-1" }),
      params()
    );
    expect(res.status).toBe(200);
    expect(tx.bug.update).toHaveBeenCalledTimes(1);
  });

  // Same defect class as the create route: v1's response already emits
  // external_issue_id/issue_tracker_url in snake_case, so accepting only
  // camelCase on input silently dropped a value patched by the MCP
  // update_bug/CI-style caller. Assert the actual db.bug.update() payload.
  describe("external_issue_id / issue_tracker_url naming (snake_case primary)", () => {
    it("persists external_issue_id/issue_tracker_url (snake_case)", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(baseBug);
      const tx = mockTx({
        externalIssueId: "JIRA-789",
        issueTrackerUrl: "https://example.atlassian.net/browse/JIRA-789",
      });
      const res = await PATCH(
        makeRequest("PATCH", {
          external_issue_id: "JIRA-789",
          issue_tracker_url: "https://example.atlassian.net/browse/JIRA-789",
        }),
        params()
      );
      expect(res.status).toBe(200);
      expect(tx.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalIssueId: "JIRA-789",
            issueTrackerUrl: "https://example.atlassian.net/browse/JIRA-789",
          }),
        })
      );
    });

    it("still persists externalIssueId/issueTrackerUrl (camelCase) for backward compatibility", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(baseBug);
      const tx = mockTx({ externalIssueId: "JIRA-321" });
      const res = await PATCH(
        makeRequest("PATCH", { externalIssueId: "JIRA-321" }),
        params()
      );
      expect(res.status).toBe(200);
      expect(tx.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalIssueId: "JIRA-321" }),
        })
      );
    });

    it("clears the field when explicitly set to null via snake_case", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue({ ...baseBug, externalIssueId: "JIRA-OLD" });
      const tx = mockTx({ externalIssueId: null });
      const res = await PATCH(
        makeRequest("PATCH", { external_issue_id: null }),
        params()
      );
      expect(res.status).toBe(200);
      expect(tx.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalIssueId: null }),
        })
      );
    });
  });

  // CQ-104: a v1 PATCH (e.g. a CI job) patching an unrelated field must not
  // silently wipe an admin's manual leakage override — it has to carry the
  // existing override forward, same as the internal PUT /api/bugs/[id] route.
  describe("leakage override carry-forward (CQ-104)", () => {
    const overriddenBug = {
      ...baseBug,
      detectionPhase: "QA",
      isLeaked: true,
      leakageOverridden: true,
      leakageOverrideReason: "Known issue, tracked separately — not a real leak.",
    };

    it("carries the existing override forward when patching an unrelated field", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(overriddenBug);
      const tx = mockTx({ title: "Updated title" });
      const res = await PATCH(makeRequest("PATCH", { title: "Updated title" }), params());
      expect(res.status).toBe(200);
      expect(tx.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isLeaked: true,
            leakageOverridden: true,
            leakageOverrideReason: "Known issue, tracked separately — not a real leak.",
          }),
        })
      );
    });

    it("does NOT carry the override forward when there was none to begin with", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(baseBug); // leakageOverridden: false
      const tx = mockTx({ title: "Updated title" });
      await PATCH(makeRequest("PATCH", { title: "Updated title" }), params());
      expect(tx.bug.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leakageOverridden: false,
            leakageOverrideReason: null,
          }),
        })
      );
    });

    it("a PRODUCTION detection phase still wins over a carried-forward non-leaked override", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue({
        ...overriddenBug,
        isLeaked: false,
        leakageOverrideReason: "Believed contained to staging.",
      });
      const res = await PATCH(
        makeRequest("PATCH", { detectionPhase: "PRODUCTION" }),
        params()
      );
      // resolveLeakage() rejects overriding a PRODUCTION bug to non-leaked —
      // same rule the internal route enforces.
      expect(res.status).toBe(400);
    });
  });

  // CQ-104: PATCH must leave an audit trail, mirroring PUT /api/bugs/[id].
  describe("audit logging (CQ-104)", () => {
    it("writes an audit log entry, attributed to the API key's owning user, when a tracked field changes", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(baseBug);
      mockTx({ severity: "CRITICAL" });
      const res = await PATCH(makeRequest("PATCH", { severity: "CRITICAL" }), params());
      expect(res.status).toBe(200);
      expect(mockAuditLogEntry).toHaveBeenCalledTimes(1);
      expect(mockAuditLogEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: readWriteKey.userId,
          action: "bug_update",
          targetId: "b1",
          metadata: expect.objectContaining({
            severity: { from: "HIGH", to: "CRITICAL" },
          }),
        })
      );
    });

    it("does not write an audit log entry when no tracked field changed", async () => {
      mockResolveApiKey.mockResolvedValue(readWriteKey);
      mockDb.bug.findFirst.mockResolvedValue(baseBug);
      mockTx({ notes: "just a note" });
      const res = await PATCH(makeRequest("PATCH", { notes: "just a note" }), params());
      expect(res.status).toBe(200);
      expect(mockAuditLogEntry).not.toHaveBeenCalled();
    });
  });
});
