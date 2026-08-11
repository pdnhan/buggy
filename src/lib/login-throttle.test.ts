import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeLoginIdentifier,
  isThrottled,
  recordLoginFailure,
  recordLoginSuccess,
  __resetLoginThrottleForTests,
  __MAX_LIVE_BUCKETS_FOR_TESTS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
} from "./login-throttle";

describe("login-throttle", () => {
  beforeEach(() => {
    __resetLoginThrottleForTests();
  });

  describe("normalizeLoginIdentifier", () => {
    it("trims whitespace and lowercases", () => {
      expect(normalizeLoginIdentifier("  Foo@Example.COM  ")).toBe("foo@example.com");
    });
  });

  describe("recordLoginFailure / isThrottled", () => {
    it("is not throttled below the limit", () => {
      const key = `below-${Math.random()}`;
      for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i++) {
        expect(recordLoginFailure(key).throttled).toBe(false);
      }
      expect(isThrottled(key).throttled).toBe(false);
      expect(isThrottled(key).failureCount).toBe(LOGIN_FAILURE_LIMIT - 1);
    });

    // 11 failed attempts on one email are throttled.
    it("throttles once failures reach the limit — the 11th (default limit=10) failure is blocked", () => {
      const key = `eleven-${Math.random()}`;
      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        expect(recordLoginFailure(key).throttled).toBe(false);
      }
      const eleventh = recordLoginFailure(key);
      expect(eleventh.throttled).toBe(true);
      // Capped at the limit rather than counting indefinitely upward.
      expect(eleventh.failureCount).toBe(LOGIN_FAILURE_LIMIT);
    });

    // A DIFFERENT email is unaffected once one account's bucket is exhausted.
    it("keeps a different identifier's bucket completely independent", () => {
      const exhausted = `exhausted-${Math.random()}`;
      const other = `other-${Math.random()}`;
      for (let i = 0; i <= LOGIN_FAILURE_LIMIT; i++) recordLoginFailure(exhausted);
      expect(isThrottled(exhausted).throttled).toBe(true);
      expect(isThrottled(other).throttled).toBe(false);
      expect(isThrottled(other).failureCount).toBe(0);
    });

    // Casing/whitespace variants share one bucket — enforced by callers
    // (src/auth.ts, src/lib/api-auth.ts) normalizing via
    // normalizeLoginIdentifier() before calling in; this module itself is
    // key-agnostic, so the property to test is that normalize() collapses
    // variants to the identical key.
    it("normalizeLoginIdentifier collapses casing/whitespace variants to the same key", () => {
      const variants = ["Foo@Example.com", "  foo@example.com  ", "FOO@EXAMPLE.COM"];
      const normalized = variants.map(normalizeLoginIdentifier);
      expect(new Set(normalized).size).toBe(1);

      const key = normalized[0];
      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
        recordLoginFailure(normalizeLoginIdentifier(variants[i % variants.length]));
      }
      expect(isThrottled(key).throttled).toBe(true);
    });

    // Uses fake timers rather than a real short window. An earlier version
    // recorded failures into a 10ms real-time window and slept 25ms: under
    // machine load the window could elapse *while the failures were still
    // being recorded*, so the count never reached the limit and the
    // throttled-assertion below failed intermittently. Driving Date.now()
    // explicitly makes the elapsed time exact instead of load-dependent.
    it("resets the window after it elapses", () => {
      vi.useFakeTimers();
      try {
        const key = `window-${Math.random()}`;
        for (let i = 0; i <= LOGIN_FAILURE_LIMIT; i++) {
          recordLoginFailure(key, 3, LOGIN_FAILURE_WINDOW_MS);
        }
        expect(isThrottled(key, 3).throttled).toBe(true);

        vi.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1);

        expect(isThrottled(key, 3).throttled).toBe(false);
        expect(isThrottled(key, 3).failureCount).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("recordLoginSuccess", () => {
    // A correct password clears the counter — this is the mechanism that
    // removes the lockout DoS (see src/lib/login-throttle.ts header).
    it("clears an exhausted bucket so the account gets a fresh budget", () => {
      const key = `recovers-${Math.random()}`;
      for (let i = 0; i <= LOGIN_FAILURE_LIMIT; i++) recordLoginFailure(key);
      expect(isThrottled(key).throttled).toBe(true);

      recordLoginSuccess(key);

      expect(isThrottled(key).throttled).toBe(false);
      expect(isThrottled(key).failureCount).toBe(0);
    });

    it("is a no-op for an identifier with no recorded failures", () => {
      const key = `never-failed-${Math.random()}`;
      expect(() => recordLoginSuccess(key)).not.toThrow();
      expect(isThrottled(key).failureCount).toBe(0);
    });
  });

  // The LRU eviction attack: src/lib/rate-limit.ts's old shared LRUCache
  // (max: 5_000) evicted the least-recently-touched entry once full — an
  // attacker flooding thousands of distinct emails could evict a victim's
  // live bucket, silently resetting their attempt count. This store must
  // NEVER evict a live bucket to make room for an attacker-chosen key.
  it("a flood of distinct identifiers cannot evict an existing account's live bucket (LRU eviction attack)", () => {
    const victim = `victim-${Math.random()}`;
    // Push the victim to exactly the limit (their attempts are all still
    // "allowed" individually, but the account is now at capacity — the
    // NEXT failure against it would be throttled).
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      recordLoginFailure(victim);
    }
    expect(isThrottled(victim).failureCount).toBe(LOGIN_FAILURE_LIMIT);
    expect(isThrottled(victim).throttled).toBe(true);

    // Flood well past the live-bucket ceiling with unique, throwaway
    // identifiers — exactly what an attacker fully controls.
    const floodSize = __MAX_LIVE_BUCKETS_FOR_TESTS + 500;
    for (let i = 0; i < floodSize; i++) {
      recordLoginFailure(`flood-${i}@attacker.test`);
    }

    // The victim's bucket must be completely untouched by the flood: same
    // failure count, still throttled — an LRU-based store would have
    // evicted it and reset the count back to 0 by now.
    expect(isThrottled(victim).failureCount).toBe(LOGIN_FAILURE_LIMIT);
    expect(isThrottled(victim).throttled).toBe(true);

    // One more real failure against the victim is STILL reported as
    // throttled, proving the bucket is intact end-to-end, not merely
    // coincidentally reporting the same numbers.
    const result = recordLoginFailure(victim);
    expect(result.throttled).toBe(true);
  }, 15_000);

  it("LOGIN_FAILURE_LIMIT / LOGIN_FAILURE_WINDOW_MS defaults match the documented policy (10 / 15min)", () => {
    expect(LOGIN_FAILURE_LIMIT).toBe(10);
    expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * 60_000);
  });
});
