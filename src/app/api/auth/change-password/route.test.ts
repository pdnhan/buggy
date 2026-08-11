import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn().mockResolvedValue(null),
}));

import { PATCH } from "./route";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ensureProjectForUser } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof vi.fn>;
const mockHashPassword = hashPassword as ReturnType<typeof vi.fn>;
const mockEnsureProjectForUser = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
};

const session = { user: { id: "u1", isWorkspaceAdmin: false, mustChangePassword: true } };
const dbUser = { id: "u1", email: "alice@example.com", password: "oldhash", mustChangePassword: true };
const dbUserNotForced = {
  id: "u1",
  email: "alice@example.com",
  password: "oldhash",
  mustChangePassword: false,
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/auth/change-password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// vitest.config.ts sets mockReset: true, which resets every mock's
// implementation (not just its call history) before each test — including
// hashPassword's mockResolvedValue("hashed") and ensureProjectForUser's
// mockResolvedValue(null) set once in the vi.mock() factories above.
// Without re-arming them here, hashPassword() would resolve to `undefined`
// after the first test — which is indistinguishable, to an un-asserting
// test, from a mutant that stores the plaintext password directly instead
// of calling hashPassword() at all. Re-arming to a fixed, known value lets
// the tests below assert db.user.update was called with THAT value (and
// not the plaintext password).
const HASHED_PASSWORD = "hashed:newpassword";

describe("PATCH /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashPassword.mockResolvedValue(HASHED_PASSWORD);
    mockEnsureProjectForUser.mockResolvedValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ password: "newpassword" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when user no longer exists in DB (stale JWT)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.user.findUnique.mockResolvedValue(null);
    const res = await PATCH(makeRequest({ password: "newpassword" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Session invalid");
  });

  it("returns 400 when password is too short", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await PATCH(makeRequest({ password: "short" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too long", async () => {
    mockAuth.mockResolvedValue(session);
    const res = await PATCH(makeRequest({ password: "a".repeat(129) }));
    expect(res.status).toBe(400);
  });

  it("returns 200 and updates password on success (forced reset — mustChangePassword true skips current-password check)", async () => {
    mockAuth.mockResolvedValue(session);
    mockDb.user.findUnique.mockResolvedValue(dbUser);
    mockDb.user.update.mockResolvedValue({ ...dbUser, mustChangePassword: false });
    const res = await PATCH(makeRequest({ password: "newpassword" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockHashPassword).toHaveBeenCalledWith("newpassword");
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ password: HASHED_PASSWORD, mustChangePassword: false }),
      })
    );
    // The stored password must be the HASHED value, never the plaintext
    // password the user submitted — kills a mutant that stores
    // `body.password` (or hashPassword()'s reset-to-undefined output)
    // directly instead of the actual hash.
    expect(mockDb.user.update.mock.calls[0][0].data.password).not.toBe("newpassword");
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: "u1", action: "password_change" }),
      })
    );
  });

  // ─── Non-forced change: current password is required and verified ────────────

  it("returns 400 when currentPassword is missing and this is not a forced reset", async () => {
    mockAuth.mockResolvedValue({ user: { ...session.user, mustChangePassword: false } });
    mockDb.user.findUnique.mockResolvedValue(dbUserNotForced);
    const res = await PATCH(makeRequest({ password: "newpassword" }));
    expect(res.status).toBe(400);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("returns 403 when currentPassword is wrong", async () => {
    mockAuth.mockResolvedValue({ user: { ...session.user, mustChangePassword: false } });
    mockDb.user.findUnique.mockResolvedValue(dbUserNotForced);
    mockVerifyPassword.mockResolvedValue(false);
    const res = await PATCH(
      makeRequest({ currentPassword: "wrong", password: "newpassword" })
    );
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("returns 200 and updates password when currentPassword is verified correct", async () => {
    mockAuth.mockResolvedValue({ user: { ...session.user, mustChangePassword: false } });
    mockDb.user.findUnique.mockResolvedValue(dbUserNotForced);
    mockVerifyPassword.mockResolvedValue(true);
    mockDb.user.update.mockResolvedValue({ ...dbUserNotForced, mustChangePassword: false });
    const res = await PATCH(
      makeRequest({ currentPassword: "correct", password: "newpassword" })
    );
    expect(res.status).toBe(200);
    expect(mockVerifyPassword).toHaveBeenCalledWith("correct", "oldhash");
    expect(mockHashPassword).toHaveBeenCalledWith("newpassword");
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ password: HASHED_PASSWORD }),
      })
    );
    expect(mockDb.user.update.mock.calls[0][0].data.password).not.toBe("newpassword");
  });
});
