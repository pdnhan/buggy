import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));

// next-auth's default export is a factory; capture the config object it's
// called with so we can invoke the jwt callback directly without spinning up
// a real NextAuth server.
let capturedConfig: {
  callbacks: {
    jwt: (params: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  };
};

vi.mock("next-auth", () => ({
  default: (config: typeof capturedConfig) => {
    capturedConfig = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));

// Capture the config object passed to Credentials(...) the same way the
// next-auth mock above captures NextAuth(...)'s config — this is what lets
// tests call the REAL authorize() (including the per-account throttle
// integration) without spinning up a real NextAuth server.
let capturedCredentialsConfig: {
  authorize: (
    credentials: Partial<Record<"email" | "password", unknown>> | undefined
  ) => Promise<unknown>;
};

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: typeof capturedCredentialsConfig) => {
    capturedCredentialsConfig = config;
    return config;
  },
}));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
}));

import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { LOGIN_FAILURE_LIMIT } from "@/lib/login-throttle";

const mockFindUnique = db.user.findUnique as ReturnType<typeof vi.fn>;
const mockVerifyPassword = verifyPassword as ReturnType<typeof vi.fn>;

describe("auth.ts jwt callback — privilege claim refresh", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import so the mocked next-auth() factory re-runs and captures a
    // fresh config for each test.
    await import("./auth");
  });

  it("sets claims and claimsRefreshedAt from the sign-in user object", async () => {
    const token = await capturedConfig.callbacks.jwt({
      token: {},
      user: { id: "u1", isWorkspaceAdmin: true, mustChangePassword: false },
    });
    expect(token.id).toBe("u1");
    expect(token.isWorkspaceAdmin).toBe(true);
    expect(token.mustChangePassword).toBe(false);
    expect(typeof token.claimsRefreshedAt).toBe("number");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not hit the DB on a subsequent call within the refresh interval", async () => {
    const token = await capturedConfig.callbacks.jwt({
      token: { id: "u1", isWorkspaceAdmin: false, mustChangePassword: false, claimsRefreshedAt: Date.now() },
    });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(token.isWorkspaceAdmin).toBe(false);
  });

  it("re-reads isWorkspaceAdmin/mustChangePassword once the refresh interval has elapsed (closes the stale-admin-claim gap)", async () => {
    mockFindUnique.mockResolvedValue({ isWorkspaceAdmin: false, mustChangePassword: true });

    const staleRefreshedAt = Date.now() - 61_000;
    const staleToken = {
      id: "u1",
      isWorkspaceAdmin: true, // stale: was demoted server-side
      mustChangePassword: false, // stale: an admin forced a reset server-side
      claimsRefreshedAt: staleRefreshedAt,
    };

    const token = await capturedConfig.callbacks.jwt({ token: staleToken });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { isWorkspaceAdmin: true, mustChangePassword: true },
    });
    expect(token.isWorkspaceAdmin).toBe(false);
    expect(token.mustChangePassword).toBe(true);
    expect(token.claimsRefreshedAt).toBeGreaterThan(staleRefreshedAt);
  });

  it("invalidates privileged claims when the user row is gone (CQ-122: no other check rejects a deleted user's JWT)", async () => {
    mockFindUnique.mockResolvedValue(null);

    const staleToken = {
      id: "deleted-user",
      isWorkspaceAdmin: true,
      mustChangePassword: false,
      claimsRefreshedAt: Date.now() - 61_000,
    };

    const token = await capturedConfig.callbacks.jwt({ token: staleToken });

    // A deleted workspace admin must not keep /api/admin/** access for the
    // remaining life of their JWT — proxy.ts only counts admins for the
    // setup gate and /api/admin/** route handlers check only this claim, so
    // this refresh is the only place that can close the hole.
    expect(token.isWorkspaceAdmin).toBe(false);
    expect(token.mustChangePassword).toBe(false);
  });

  it("fails CLOSED (keeps existing claims, does not throw) when the refresh query errors (CQ-119)", async () => {
    mockFindUnique.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const staleRefreshedAt = Date.now() - 61_000;
    const staleToken = {
      id: "u1",
      isWorkspaceAdmin: true,
      mustChangePassword: false,
      claimsRefreshedAt: staleRefreshedAt,
    };

    // Must not throw out of the jwt callback — that would make auth()
    // resolve to null for every signed-in user, i.e. a DB blip becomes a
    // total auth outage (both the admin gate and mustChangePassword gate
    // fall through when auth() is null).
    const token = await capturedConfig.callbacks.jwt({ token: { ...staleToken } });

    // Fails closed: existing claims survive untouched, neither upgraded nor
    // downgraded.
    expect(token.isWorkspaceAdmin).toBe(true);
    expect(token.mustChangePassword).toBe(false);
    expect(token.claimsRefreshedAt).toBe(staleRefreshedAt);
    // The failure is logged, not swallowed silently.
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("auth.ts credentials authorize() — per-account failure throttle (CQ-128 fix)", () => {
  let loginThrottle: typeof import("@/lib/login-throttle");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import so both the mocked next-auth() factory AND the real
    // src/lib/login-throttle.ts module are fresh per test — the throttle's
    // in-memory store is a module-level singleton, so a stale one would leak
    // failure counts across tests otherwise.
    await import("./auth");
    loginThrottle = await import("@/lib/login-throttle");
    loginThrottle.__resetLoginThrottleForTests();
  });

  function authorize(email: unknown, password: unknown) {
    return capturedCredentialsConfig.authorize({ email, password });
  }

  it("returns null without touching the DB when credentials are missing", async () => {
    expect(await capturedCredentialsConfig.authorize(undefined)).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null and records a failure when the account does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const email = `nouser-${Math.random()}@example.com`;

    const result = await authorize(email, "whatever");

    expect(result).toBeNull();
    expect(loginThrottle.isThrottled(email).failureCount).toBe(1);
  });

  it("blocks — reports throttled — after LOGIN_FAILURE_LIMIT consecutive wrong guesses against ONE email", async () => {
    const email = `bruteforced-${Math.random()}@example.com`;
    mockFindUnique.mockResolvedValue({ id: "u1", email, password: "hashed" });
    mockVerifyPassword.mockResolvedValue(false);

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      expect(await authorize(email, `guess${i}`)).toBeNull();
    }

    expect(loginThrottle.isThrottled(email).throttled).toBe(true);
  });

  it("leaves a DIFFERENT email's throttle state unaffected once one account's bucket is exhausted", async () => {
    const target = `target-${Math.random()}@example.com`;
    const other = `other-${Math.random()}@example.com`;
    mockFindUnique.mockResolvedValue({ id: "u1", email: target, password: "hashed" });
    mockVerifyPassword.mockResolvedValue(false);

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      await authorize(target, `guess${i}`);
    }

    expect(loginThrottle.isThrottled(target).throttled).toBe(true);
    expect(loginThrottle.isThrottled(other).throttled).toBe(false);
  });

  it("shares one bucket across casing/whitespace variants of the same email", async () => {
    const base = `casing-${Math.random()}`;
    const normalized = `${base}@example.com`;
    mockFindUnique.mockResolvedValue({ id: "u1", email: normalized, password: "hashed" });
    mockVerifyPassword.mockResolvedValue(false);

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      // Alternate casing/whitespace on every call — all must land in the
      // SAME bucket, or an attacker could double their attempt budget.
      const submitted = i % 2 === 0 ? `  ${base.toUpperCase()}@EXAMPLE.COM  ` : normalized;
      expect(await authorize(submitted, `guess${i}`)).toBeNull();
    }

    expect(loginThrottle.isThrottled(normalized).throttled).toBe(true);
  });

  // Mandatory property (choice b, documented in src/lib/login-throttle.ts):
  // a correct password must still authenticate even after the account's
  // failure bucket is exhausted — this is what removes the lockout DoS
  // (anyone who knows a user's, or a workspace admin's, email can no longer
  // lock them out just by repeating wrong guesses). Also proves the success
  // path clears the counter.
  it("still authenticates a correct password after the account's failure bucket is exhausted, and clears the counter on success", async () => {
    const email = `recovers-${Math.random()}@example.com`;
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email,
      name: "Victim",
      image: null,
      isWorkspaceAdmin: false,
      mustChangePassword: false,
      password: "hashed",
    });
    mockVerifyPassword.mockResolvedValue(false);

    // Attacker exhausts the bucket well past the limit.
    for (let i = 0; i < LOGIN_FAILURE_LIMIT + 5; i++) {
      expect(await authorize(email, `wrong-guess-${i}`)).toBeNull();
    }
    expect(loginThrottle.isThrottled(email).throttled).toBe(true);

    // The real user's correct password still works.
    mockVerifyPassword.mockResolvedValue(true);
    const result = await authorize(email, "the-real-password");
    expect(result).toMatchObject({ id: "u1", email });

    // And the bucket is cleared — a mistyped password right afterwards
    // gets the account's full budget again, not a pre-exhausted one.
    expect(loginThrottle.isThrottled(email).failureCount).toBe(0);
  });

  // Structural bypass-proofing: NextAuth (@auth/core) is now the ONLY
  // parser of the login body. A duplicate `email` field or a
  // Content-Type: application/json body is resolved to a single
  // `credentials.email` value BEFORE authorize() is ever invoked (see
  // node_modules/@auth/core/lib/utils/web.js:6-16 and the header comment in
  // src/lib/login-throttle.ts for the bypasses this replaced). There is no
  // second parser here to disagree with it, so whatever @auth/core resolves
  // is exactly what gets throttled — demonstrated by deriving `email` with
  // @auth/core's own parsing logic from the same payloads that defeated the
  // old src/proxy.ts implementation (verified via a live probe against the
  // real parser before this fix; 50/50 guesses bypassed it either way).
  it("cannot be evaded by a duplicate `email` field or a JSON content-type — there is only one parser now", async () => {
    const victim = `victim-${Math.random()}@example.com`;
    mockFindUnique.mockResolvedValue({ id: "u1", email: victim, password: "hashed" });
    mockVerifyPassword.mockResolvedValue(false);

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      // Duplicate-field trick: FormData.get() (the old, deleted proxy.ts
      // parser) would have read the FIRST (rotating decoy) value here;
      // @auth/core's Object.fromEntries(new URLSearchParams(...)) reads the
      // LAST — the constant victim. authorize() only ever sees whichever
      // value @auth/core resolved.
      const urlEncodedBody = `email=decoy${i}@attacker.test&email=${encodeURIComponent(victim)}&password=guess${i}`;
      const emailAuthCoreParsed = Object.fromEntries(new URLSearchParams(urlEncodedBody)).email;
      expect(emailAuthCoreParsed).toBe(victim);
      await authorize(emailAuthCoreParsed, `guess${i}`);
    }
    expect(loginThrottle.isThrottled(victim).throttled).toBe(true);

    // JSON-body trick: the old proxy.ts's `.formData()` threw on this and
    // its bare catch{} silently dropped the whole per-account layer.
    // @auth/core parses JSON bodies directly and always did.
    const jsonBody = JSON.stringify({ email: victim, password: "one-more-guess" });
    const emailFromJson = JSON.parse(jsonBody).email;
    expect(emailFromJson).toBe(victim);
    await authorize(emailFromJson, "one-more-guess");
    expect(loginThrottle.isThrottled(victim).throttled).toBe(true);
  });
});
