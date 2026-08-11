import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// Mock the db module and lru-cache before importing api-auth
vi.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { resolveApiKey, resolveBasicAuth } from "./api-auth";
import { db } from "./db";
import {
  isThrottled,
  __resetLoginThrottleForTests,
  LOGIN_FAILURE_LIMIT,
} from "./login-throttle";

const mockDb = db as unknown as {
  apiKey: { findMany: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

describe("resolveApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty string", async () => {
    const result = await resolveApiKey("");
    expect(result).toBeNull();
    expect(mockDb.apiKey.findMany).not.toHaveBeenCalled();
  });

  it("returns null when no candidates found by prefix", async () => {
    mockDb.apiKey.findMany.mockResolvedValue([]);
    const result = await resolveApiKey("abcd1234xyz");
    expect(result).toBeNull();
  });

  it("returns null when prefix matches but bcrypt fails", async () => {
    const keyHash = await bcrypt.hash("abcd1234correctkey", 4);
    mockDb.apiKey.findMany.mockResolvedValue([
      { id: "key1", keyPrefix: "abcd1234", keyHash, project: { id: "proj1" } },
    ]);
    const result = await resolveApiKey("abcd1234wrongkeyxyz");
    expect(result).toBeNull();
  });

  it("returns the matching key when bcrypt succeeds", async () => {
    const rawKey = "abcd1234" + "a".repeat(56);
    const keyHash = await bcrypt.hash(rawKey, 4);
    const candidate = { id: "key1", keyPrefix: "abcd1234", keyHash, project: { id: "proj1" } };
    mockDb.apiKey.findMany.mockResolvedValue([candidate]);

    const result = await resolveApiKey(rawKey);
    expect(result).toEqual(candidate);
  });

  it("returns cached result on second call (single DB call)", async () => {
    const rawKey = "cachetest" + "b".repeat(55);
    const keyHash = await bcrypt.hash(rawKey, 4);
    const candidate = { id: "key2", keyPrefix: "cachet", keyHash, project: { id: "proj2" } };
    mockDb.apiKey.findMany.mockResolvedValue([candidate]);

    await resolveApiKey(rawKey);
    await resolveApiKey(rawKey);

    // DB should only be called once due to LRU cache
    expect(mockDb.apiKey.findMany).toHaveBeenCalledTimes(1);
  });

  it("excludes expired keys from the candidate query", async () => {
    mockDb.apiKey.findMany.mockResolvedValue([]);
    await resolveApiKey("someprefix" + "c".repeat(55));

    const where = mockDb.apiKey.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("does not authenticate a key that expired after being cached", async () => {
    const rawKey = "expiretest" + "d".repeat(54);
    const keyHash = await bcrypt.hash(rawKey, 4);
    const expiresAt = new Date(Date.now() + 50); // expires 50ms from now
    const candidate = {
      id: "key3",
      keyPrefix: "expiret",
      keyHash,
      expiresAt,
      project: { id: "proj3" },
    };
    mockDb.apiKey.findMany.mockResolvedValue([candidate]);

    const first = await resolveApiKey(rawKey);
    expect(first).toEqual(candidate);

    await new Promise((r) => setTimeout(r, 60));

    const second = await resolveApiKey(rawKey);
    expect(second).toBeNull();
  });
});

describe("resolveBasicAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLoginThrottleForTests();
  });

  it("returns null for null header", async () => {
    const result = await resolveBasicAuth(null);
    expect(result).toBeNull();
  });

  it("returns null for missing 'Basic ' prefix", async () => {
    const result = await resolveBasicAuth("Bearer abc");
    expect(result).toBeNull();
  });

  it("returns null for invalid base64 (no colon)", async () => {
    const encoded = Buffer.from("nocolon").toString("base64");
    const result = await resolveBasicAuth(`Basic ${encoded}`);
    expect(result).toBeNull();
  });

  it("returns null when user not found", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const encoded = Buffer.from("unknown@example.com:password").toString("base64");
    const result = await resolveBasicAuth(`Basic ${encoded}`);
    expect(result).toBeNull();
  });

  it("returns null when password does not match", async () => {
    const passwordHash = await bcrypt.hash("correctpass", 4);
    mockDb.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", password: passwordHash });
    const encoded = Buffer.from("a@b.com:wrongpass").toString("base64");
    const result = await resolveBasicAuth(`Basic ${encoded}`);
    expect(result).toBeNull();
  });

  it("returns user when credentials are valid", async () => {
    const passwordHash = await bcrypt.hash("correctpass", 4);
    const user = { id: "u1", email: "a@b.com", password: passwordHash };
    mockDb.user.findUnique.mockResolvedValue(user);
    const encoded = Buffer.from("a@b.com:correctpass").toString("base64");
    const result = await resolveBasicAuth(`Basic ${encoded}`);
    expect(result).toEqual(user);
  });

  // CQ-128 fix, HTTP Basic auth side: shares src/lib/login-throttle.ts with
  // src/auth.ts's credentials authorize(). This exercises the CI-account
  // path (BASIC_AUTH_PATHS in src/proxy.ts — POST/DELETE /api/v1/api-keys,
  // /api/v1/projects) with the same required properties.
  describe("per-account failure throttle", () => {
    function basicAuthHeader(email: string, password: string) {
      return `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`;
    }

    it("blocks — reports throttled — after LOGIN_FAILURE_LIMIT consecutive wrong guesses against one email", async () => {
      const email = `ci-brute-${Math.random()}@example.com`;
      const passwordHash = await bcrypt.hash("correctpass", 4);
      mockDb.user.findUnique.mockResolvedValue({ id: "u1", email, password: passwordHash });

      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        expect(await resolveBasicAuth(basicAuthHeader(email, `wrong${i}`))).toBeNull();
      }
      expect(isThrottled(email).throttled).toBe(true);
    });

    it("leaves a DIFFERENT email unaffected once one account's bucket is exhausted", async () => {
      const target = `ci-target-${Math.random()}@example.com`;
      const other = `ci-other-${Math.random()}@example.com`;
      const passwordHash = await bcrypt.hash("correctpass", 4);
      mockDb.user.findUnique.mockResolvedValue({ id: "u1", email: target, password: passwordHash });

      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        await resolveBasicAuth(basicAuthHeader(target, `wrong${i}`));
      }
      expect(isThrottled(target).throttled).toBe(true);
      expect(isThrottled(other).throttled).toBe(false);
    });

    it("shares one bucket across casing/whitespace variants of the same email", async () => {
      const base = `ci-casing-${Math.random()}`;
      const normalized = `${base}@example.com`;
      const passwordHash = await bcrypt.hash("correctpass", 4);
      mockDb.user.findUnique.mockResolvedValue({ id: "u1", email: normalized, password: passwordHash });

      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        const submitted = i % 2 === 0 ? `${base.toUpperCase()}@EXAMPLE.COM` : normalized;
        await resolveBasicAuth(basicAuthHeader(submitted, `wrong${i}`));
      }
      expect(isThrottled(normalized).throttled).toBe(true);
    });

    // Mandatory property (choice b): a CI account's correct API key/password
    // must still authenticate after its bucket is exhausted — this is what
    // removes the "10 key operations per 15 minutes then permanently
    // throttled" DoS described in the task. Also proves the success path
    // clears the counter.
    it("still authenticates correct credentials after the account's failure bucket is exhausted, and clears the counter", async () => {
      const email = `ci-recovers-${Math.random()}@example.com`;
      const passwordHash = await bcrypt.hash("correctpass", 4);
      mockDb.user.findUnique.mockResolvedValue({ id: "u1", email, password: passwordHash });

      for (let i = 0; i < LOGIN_FAILURE_LIMIT + 5; i++) {
        expect(await resolveBasicAuth(basicAuthHeader(email, `wrong${i}`))).toBeNull();
      }
      expect(isThrottled(email).throttled).toBe(true);

      const result = await resolveBasicAuth(basicAuthHeader(email, "correctpass"));
      expect(result).not.toBeNull();
      expect(result?.email).toBe(email);

      expect(isThrottled(email).failureCount).toBe(0);
    });
  });
});
