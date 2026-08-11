import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  resolveBasicAuth: vi.fn(),
  generateApiKey: vi.fn(() => ({ rawKey: "raw-key-value", keyPrefix: "rawkeyv" })),
  hashApiKey: vi.fn(async () => "hashed"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    projectMember: { findMany: vi.fn() },
    apiKey: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userIsProjectAdmin: vi.fn(),
}));

import { GET, POST } from "./route";
import { resolveBasicAuth } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { userIsProjectAdmin } from "@/lib/projects";

const mockResolveBasicAuth = resolveBasicAuth as ReturnType<typeof vi.fn>;
const mockIsAdmin = userIsProjectAdmin as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  projectMember: { findMany: ReturnType<typeof vi.fn> };
  apiKey: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

const user = { id: "user-1" };

function basicAuthHeader() {
  return { authorization: `Basic ${Buffer.from("a@b.com:pw").toString("base64")}` };
}

function makeGetRequest(query = "") {
  return new Request(`http://localhost/api/v1/api-keys?${query}`, { headers: basicAuthHeader() });
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/v1/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...basicAuthHeader() },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/api-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 for invalid credentials", async () => {
    mockResolveBasicAuth.mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("lists keys for the caller's projects", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockDb.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }]);
    mockDb.apiKey.findMany.mockResolvedValue([]);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/api-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 for invalid credentials", async () => {
    mockResolveBasicAuth.mockResolvedValue(null);
    const res = await POST(makePostRequest({ project_id: "p1", name: "ci" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a project member who is not an admin (closes the VIEWER→READ_WRITE escalation)", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockIsAdmin.mockResolvedValue(false);
    const res = await POST(makePostRequest({ project_id: "p1", name: "ci" }));
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.create).not.toHaveBeenCalled();
  });

  it("creates a key for a project admin with the requested scope", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockIsAdmin.mockResolvedValue(true);
    mockDb.apiKey.create.mockResolvedValue({
      id: "k1",
      name: "ci",
      scope: "READ_ONLY",
      keyPrefix: "rawkeyv",
      projectId: "p1",
      createdAt: new Date(),
    });
    const res = await POST(makePostRequest({ project_id: "p1", name: "ci", scope: "READ_ONLY" }));
    expect(res.status).toBe(201);
    const createArgs = mockDb.apiKey.create.mock.calls[0][0];
    expect(createArgs.data.scope).toBe("READ_ONLY");
  });
});
