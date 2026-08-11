import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  resolveBasicAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  userIsProjectAdmin: vi.fn(),
}));

import { DELETE } from "./route";
import { resolveBasicAuth } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { userIsProjectAdmin } from "@/lib/projects";

const mockResolveBasicAuth = resolveBasicAuth as ReturnType<typeof vi.fn>;
const mockIsAdmin = userIsProjectAdmin as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  apiKey: { findFirst: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

const user = { id: "user-1", email: "user1@example.com" };
const apiKey = { id: "key-1", projectId: "p1" };

function makeRequest(token = "user1@example.com:password") {
  return new Request("http://localhost/api/v1/api-keys/key-1", {
    method: "DELETE",
    headers: token
      ? { authorization: `Basic ${Buffer.from(token).toString("base64")}` }
      : {},
  });
}

function params() {
  return { params: Promise.resolve({ id: "key-1" }) };
}

describe("DELETE /api/v1/api-keys/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without valid credentials", async () => {
    mockResolveBasicAuth.mockResolvedValue(null);
    const res = await DELETE(makeRequest(""), params());
    expect(res.status).toBe(401);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("returns 404 when the key is not in a project the user belongs to (does not leak existence)", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockDb.apiKey.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(404);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("returns 403 for a VIEWER (member but not admin) — closes the VIEWER-delete escalation", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockDb.apiKey.findFirst.mockResolvedValue(apiKey);
    mockIsAdmin.mockResolvedValue(false);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("returns 403 for a MEMBER (member but not admin)", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockDb.apiKey.findFirst.mockResolvedValue(apiKey);
    mockIsAdmin.mockResolvedValue(false);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("returns 200 and actually issues the delete for an ADMIN", async () => {
    mockResolveBasicAuth.mockResolvedValue(user);
    mockDb.apiKey.findFirst.mockResolvedValue(apiKey);
    mockIsAdmin.mockResolvedValue(true);
    mockDb.apiKey.delete.mockResolvedValue(apiKey);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(mockDb.apiKey.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
    expect(mockIsAdmin).toHaveBeenCalledWith("user-1", "p1");
  });
});
