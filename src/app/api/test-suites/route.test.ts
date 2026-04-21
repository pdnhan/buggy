import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testCase: {
      count: vi.fn(),
    },
    testSuite: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userHasProjectAccess: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userHasProjectAccess } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  testCase: { count: ReturnType<typeof vi.fn> };
  testSuite: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const session = { user: { id: "user-1" } };

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/test-suites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(projectId?: string) {
  const url = projectId
    ? `http://localhost/api/test-suites?projectId=${projectId}`
    : "http://localhost/api/test-suites";
  return new Request(url);
}

// ─── GET /api/test-suites ─────────────────────────────────────────────────────

describe("GET /api/test-suites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest("p1"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when project cannot be resolved", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks project access", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(false);
    const res = await GET(makeGetRequest("p1"));
    expect(res.status).toBe(403);
  });

  it("returns suites list for a valid project member", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.testSuite.findMany.mockResolvedValue([
      { id: "s1", name: "Smoke Tests", cases: [] },
    ]);
    const res = await GET(makeGetRequest("p1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suites).toHaveLength(1);
    expect(data.suites[0].name).toBe("Smoke Tests");
    expect(data.projectId).toBe("p1");
  });
});

// ─── POST /api/test-suites ────────────────────────────────────────────────────

describe("POST /api/test-suites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makePostRequest({ name: "New Suite", projectId: "p1" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when project cannot be resolved", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue(null);
    const res = await POST(makePostRequest({ name: "New Suite" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks project access", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(false);
    const res = await POST(makePostRequest({ name: "New Suite", projectId: "p1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid payload (empty name)", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await POST(makePostRequest({ name: "", projectId: "p1" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid payload/i);
  });

  it("returns 400 for invalid payload (name too long)", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await POST(makePostRequest({ name: "x".repeat(121), projectId: "p1" }));
    expect(res.status).toBe(400);
  });

  // Bug 1: cross-project test case validation
  it("returns 422 when testCaseIds include IDs not belonging to the project", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.testCase.count.mockResolvedValue(1); // only 1 of the 2 IDs found in project
    const res = await POST(
      makePostRequest({
        name: "New Suite",
        projectId: "p1",
        testCaseIds: ["tc-valid", "tc-other-project"],
      })
    );
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/do not belong/i);
  });

  it("skips ownership check and succeeds when testCaseIds is empty", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.testSuite.create.mockResolvedValue({ id: "s1", name: "Empty Suite", cases: [] });
    const res = await POST(makePostRequest({ name: "Empty Suite", projectId: "p1" }));
    expect(mockDb.testCase.count).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  // Bug 2: duplicate suite name → 409 instead of 500
  it("returns 409 when suite name already exists in the project", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    const { Prisma } = await import("@prisma/client");
    const dupError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mockDb.testSuite.create.mockRejectedValue(dupError);
    const res = await POST(makePostRequest({ name: "Existing Suite", projectId: "p1" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/i);
  });

  it("returns 201 with the created suite on success (no test cases)", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    const suite = { id: "s1", name: "Smoke Tests", description: null, projectId: "p1", cases: [] };
    mockDb.testSuite.create.mockResolvedValue(suite);
    const res = await POST(makePostRequest({ name: "Smoke Tests", projectId: "p1" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.suite.name).toBe("Smoke Tests");
  });

  it("returns 201 with the created suite on success (with test cases)", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.testCase.count.mockResolvedValue(2); // both IDs belong to the project
    const suite = {
      id: "s1",
      name: "Regression",
      projectId: "p1",
      cases: [
        {
          testCase: {
            id: "tc-1",
            title: "Login test",
            priority: "HIGH",
            status: "ACTIVE",
            displayId: "TC-0001",
            jiraKey: null,
            module: null,
          },
        },
        {
          testCase: {
            id: "tc-2",
            title: "Logout test",
            priority: "LOW",
            status: "ACTIVE",
            displayId: "TC-0002",
            jiraKey: null,
            module: null,
          },
        },
      ],
    };
    mockDb.testSuite.create.mockResolvedValue(suite);
    const res = await POST(
      makePostRequest({ name: "Regression", projectId: "p1", testCaseIds: ["tc-1", "tc-2"] })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.suite.cases).toHaveLength(2);
  });
});
