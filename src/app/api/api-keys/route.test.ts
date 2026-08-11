import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userHasProjectAccess: vi.fn(),
  userIsProjectAdmin: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  generateApiKey: vi.fn(() => ({ rawKey: "raw-key-value", keyPrefix: "rawkeyv" })),
  hashApiKey: vi.fn(async () => "hashed"),
}));

import { GET, POST } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess, userIsProjectAdmin } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockHasAccess = userHasProjectAccess as ReturnType<typeof vi.fn>;
const mockIsAdmin = userIsProjectAdmin as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  apiKey: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "user-1" } };

function makeGetRequest(query = "projectId=p1") {
  return new Request(`http://localhost/api/api-keys?${query}`);
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/api-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-member", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(false);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  it("lists keys for any member (VIEWER can view metadata)", async () => {
    mockAuth.mockResolvedValue(session);
    mockHasAccess.mockResolvedValue(true);
    mockDb.apiKey.findMany.mockResolvedValue([]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/api-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makePostRequest({ projectId: "p1", name: "ci" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a project member who is not an admin (closes the VIEWER→READ_WRITE escalation)", async () => {
    mockAuth.mockResolvedValue(session);
    mockIsAdmin.mockResolvedValue(false);
    const res = await POST(makePostRequest({ projectId: "p1", name: "ci" }));
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.create).not.toHaveBeenCalled();
  });

  it("creates a key for a project admin", async () => {
    mockAuth.mockResolvedValue(session);
    mockIsAdmin.mockResolvedValue(true);
    mockDb.apiKey.create.mockResolvedValue({});
    const res = await POST(makePostRequest({ projectId: "p1", name: "ci" }));
    expect(res.status).toBe(201);
    const createArgs = mockDb.apiKey.create.mock.calls[0][0];
    expect(createArgs.data.scope).toBe("READ_WRITE");
    expect(createArgs.data.projectId).toBe("p1");
  });
});
