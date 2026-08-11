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
    bug: { findMany: vi.fn() },
    projectMember: { findMany: vi.fn() },
    apiKey: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { GET, POST } from "./route";
import { resolveApiKey } from "@/lib/api-auth";
import { db } from "@/lib/db";

const mockResolveApiKey = resolveApiKey as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  bug: { findMany: ReturnType<typeof vi.fn> };
  projectMember: { findMany: ReturnType<typeof vi.fn> };
  apiKey: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const readWriteKey = { id: "key-1", projectId: "p1", userId: "user-1", scope: "READ_WRITE" };
const readOnlyKey = { id: "key-2", projectId: "p1", userId: "user-1", scope: "READ_ONLY" };

function makeGetRequest(query = "", token = "valid-key") {
  return new Request(`http://localhost/api/v1/bugs?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(body: unknown, token = "valid-key") {
  return new Request("http://localhost/api/v1/bugs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  title: "Checkout crashes on submit",
  severity: "HIGH",
  detectionPhase: "QA",
};

describe("GET /api/v1/bugs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a token", async () => {
    const res = await GET(makeGetRequest("", ""));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid key", async () => {
    mockResolveApiKey.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("scopes the findMany call to the key's project, not a caller-supplied one", async () => {
    // The audit that flagged this file found the previous version of this
    // test asserted the response shape but never inspected the Prisma
    // call — so deleting the projectId scope from the route would have
    // still passed. Assert the actual where clause, and prove a
    // caller-supplied projectId in the query string cannot override it.
    mockResolveApiKey.mockResolvedValue({ ...readWriteKey, projectId: "real-project" });
    mockDb.bug.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("projectId=attacker-project"));
    const where = mockDb.bug.findMany.mock.calls[0][0].where;
    expect(where.projectId).toBe("real-project");
  });

  it("returns the bug list scoped to the key's project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findMany.mockResolvedValue([
      {
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
        status: "OPEN",
        reopenCount: 0,
        firstDetectedDate: null,
        firstReopenedDate: null,
        lastReopenedDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bugs).toHaveLength(1);
    expect(data.bugs[0].display_id).toBe("BUG-0001");
  });

  // CQ-106: Number("abc") is NaN, which used to reach Prisma as `take`
  // (a 500) instead of a clear validation error.
  it("returns 400 for a non-numeric limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=abc"));
    expect(res.status).toBe(400);
    expect(mockDb.bug.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=-1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a zero limit", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await GET(makeGetRequest("limit=0"));
    expect(res.status).toBe(400);
  });

  it("applies the default limit (50) when absent", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findMany.mockResolvedValue([]);
    await GET(makeGetRequest());
    expect(mockDb.bug.findMany.mock.calls[0][0].take).toBe(51);
  });

  it("passes a valid limit through as `take`", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.bug.findMany.mockResolvedValue([]);
    await GET(makeGetRequest("limit=5"));
    expect(mockDb.bug.findMany.mock.calls[0][0].take).toBe(6);
  });
});

describe("POST /api/v1/bugs", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockTransaction() {
    const tx = {
      module: { upsert: vi.fn() },
      project: { update: vi.fn().mockResolvedValue({ bugCounter: 1 }) },
      bug: {
        create: vi.fn().mockResolvedValue({
          id: "b1",
          displayId: "BUG-0001",
          title: validPayload.title,
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
          status: "OPEN",
          reopenCount: 0,
          firstDetectedDate: null,
          firstReopenedDate: null,
          lastReopenedDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    return tx;
  }

  it("returns 401 without a token", async () => {
    const res = await POST(makePostRequest(validPayload, ""));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a READ_ONLY key", async () => {
    mockResolveApiKey.mockResolvedValue(readOnlyKey);
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(403);
  });

  it("returns 400 for a payload missing required fields", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const res = await POST(makePostRequest({ title: "x" }));
    expect(res.status).toBe(400);
  });

  it("creates a bug, defaults reporter to the key's user, and auto-classifies leakage", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = mockTransaction();
    const res = await POST(makePostRequest(validPayload));
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.reporterId).toBe("user-1");
    expect(createArgs.data.isLeaked).toBe(false); // QA phase is not leaked by default
    expect(createArgs.data.leakageOverridden).toBe(false);
  });

  it("auto-classifies a production-detected bug as leaked", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = mockTransaction();
    const res = await POST(makePostRequest({ ...validPayload, detectionPhase: "PRODUCTION" }));
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.isLeaked).toBe(true);
  });

  it("ignores a leakageOverride field in the payload (not supported over the API)", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = mockTransaction();
    // createBugSchema doesn't include leakageOverride, so it's stripped by Zod parsing.
    const res = await POST(
      makePostRequest({
        ...validPayload,
        detectionPhase: "PRODUCTION",
        leakageOverride: { isLeaked: false, reason: "should be ignored" },
      })
    );
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.isLeaked).toBe(true);
    expect(createArgs.data.leakageOverridden).toBe(false);
  });

  // CQ-103: assignee ids must belong to the key's project
  it("returns 422 when assignedDeveloperId is not a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.projectMember.findMany.mockResolvedValue([]);
    const res = await POST(
      makePostRequest({ ...validPayload, assignedDeveloperId: "outsider-user" })
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/must reference members of the project/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("creates the bug when assignedDeveloperId is a member of the project", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    mockDb.projectMember.findMany.mockResolvedValue([{ userId: "teammate-1" }]);
    const tx = mockTransaction();
    const res = await POST(
      makePostRequest({ ...validPayload, assignedDeveloperId: "teammate-1" })
    );
    expect(res.status).toBe(201);
    expect(tx.bug.create).toHaveBeenCalledTimes(1);
  });

  // The MCP create_bug tool (mcp-server/src/tools/bugs.ts) sends
  // external_issue_id / issue_tracker_url in snake_case, matching v1's
  // response shape (formatBug already emits external_issue_id /
  // issue_tracker_url). Zod strips unrecognized keys, so before this fix
  // the values were silently discarded: a 201 came back but the Jira link
  // was gone. Assert against the actual db.bug.create() payload, not just
  // the status code — that's the only way this class of bug gets caught.
  it("persists external_issue_id/issue_tracker_url (snake_case) sent by the MCP tool", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = mockTransaction();
    const res = await POST(
      makePostRequest({
        ...validPayload,
        external_issue_id: "JIRA-123",
        issue_tracker_url: "https://example.atlassian.net/browse/JIRA-123",
      })
    );
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.externalIssueId).toBe("JIRA-123");
    expect(createArgs.data.issueTrackerUrl).toBe(
      "https://example.atlassian.net/browse/JIRA-123"
    );
  });

  it("still persists externalIssueId/issueTrackerUrl (camelCase) for backward compatibility", async () => {
    mockResolveApiKey.mockResolvedValue(readWriteKey);
    const tx = mockTransaction();
    const res = await POST(
      makePostRequest({
        ...validPayload,
        externalIssueId: "JIRA-456",
        issueTrackerUrl: "https://example.atlassian.net/browse/JIRA-456",
      })
    );
    expect(res.status).toBe(201);
    const createArgs = tx.bug.create.mock.calls[0][0];
    expect(createArgs.data.externalIssueId).toBe("JIRA-456");
    expect(createArgs.data.issueTrackerUrl).toBe(
      "https://example.atlassian.net/browse/JIRA-456"
    );
  });
});
