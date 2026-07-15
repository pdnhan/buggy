import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspaceSettings: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { GET, PATCH } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  workspaceSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

const adminSession = { user: { id: "u1", isWorkspaceAdmin: true } };
const memberSession = { user: { id: "u2", isWorkspaceAdmin: false } };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuth.mockResolvedValue(memberSession);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns settings for workspace admin", async () => {
    mockAuth.mockResolvedValue(adminSession);
    mockDb.workspaceSettings.findFirst.mockResolvedValue({
      enableSessionTesting: true,
      enableReleaseTracking: false,
      openRegistration: true,
      enableBugTracking: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      enableSessionTesting: true,
      enableReleaseTracking: false,
      openRegistration: true,
      enableBugTracking: false,
    });
  });

  it("returns all-false defaults when no settings row exists", async () => {
    mockAuth.mockResolvedValue(adminSession);
    mockDb.workspaceSettings.findFirst.mockResolvedValue(null);

    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({
      enableSessionTesting: false,
      enableReleaseTracking: false,
      openRegistration: false,
      enableBugTracking: false,
    });
  });
});

describe("PATCH /api/admin/settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuth.mockResolvedValue(memberSession);
    const res = await PATCH(makeRequest({}));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON body", async () => {
    mockAuth.mockResolvedValue(adminSession);
    const req = new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      body: "not-json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for wrong field types", async () => {
    mockAuth.mockResolvedValue(adminSession);
    const res = await PATCH(makeRequest({ enableSessionTesting: "yes" }));
    expect(res.status).toBe(400);
  });

  it("upserts settings and returns updated row", async () => {
    mockAuth.mockResolvedValue(adminSession);
    const updated = {
      id: "singleton",
      enableSessionTesting: true,
      enableReleaseTracking: false,
      openRegistration: false,
    };
    mockDb.workspaceSettings.upsert.mockResolvedValue(updated);

    const res = await PATCH(makeRequest({ enableSessionTesting: true }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enableSessionTesting).toBe(true);
    expect(mockDb.workspaceSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        update: { enableSessionTesting: true },
      })
    );
  });
});
