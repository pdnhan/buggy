import { LRUCache } from "lru-cache";

// In-process fixed-window rate limiter shared by src/proxy.ts (login +
// public v1 API IP/circuit-breaker throttling). Per-process only — not
// shared across replicas — same tradeoff as the API-key resolution cache in
// src/lib/api-auth.ts, which is an acceptable fit for this app's
// single-instance/docker-compose deploy model. A multi-instance deployment
// would need a shared store (e.g. Redis) instead.
//
// Keys here are either a fixed circuit-breaker constant (`login:__circuit__`,
// `api:__circuit__`) or `${bucket}:${ip}` where `ip` is only ever a value
// clientIp() in src/proxy.ts trusts (unset by default; the real client IP as
// seen by a configured number of trusted proxy hops otherwise) — never a
// bare attacker-suppliable string. A bounded LRU is a reasonable fit for
// that: an untrusted caller can't produce enough distinct TRUSTED keys to
// flood it, and even an attacker with many real IPs merely spends the
// entries on their own botnet, not a chosen victim's key.
//
// Per-ACCOUNT login throttling (keyed on a submitted, fully attacker-chosen
// email) used to live here too (`login:acct:<email>`) and that was wrong:
// flooding 5,000+ distinct emails evicted a victim's live bucket, silently
// resetting their attempt count (verified against this exact cache). That
// logic has moved to src/lib/login-throttle.ts, which uses its own store
// that never evicts a live bucket to make room for an attacker-chosen key —
// see that file for the design. Do not key anything attacker-chosen off
// this cache again.
const buckets = new LRUCache<string, { count: number; resetAt: number }>({
  max: 5_000,
  ttl: 15 * 60_000,
});

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

// Test-only: clears all buckets. Needed because `buckets` is a module-level
// singleton — without this, tests that share a key (e.g. the "unproxied"
// fallback bucket) leak state into each other across test cases.
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}
