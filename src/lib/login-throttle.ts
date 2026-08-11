// Per-account failed-login-attempt throttle, shared by src/auth.ts's
// credentials authorize() and src/lib/api-auth.ts's resolveBasicAuth() — the
// two places a raw email+password pair is checked against the DB. This used
// to live in src/proxy.ts (CQ-128), reading the submitted email itself by
// calling `.formData()` on a cloned middleware request. That was a SECOND
// parser of the login body, independent of the one @auth/core actually uses
// to authenticate (`Object.fromEntries(new URLSearchParams(text))` for
// url-encoded bodies, `req.json()` for JSON — see
// node_modules/@auth/core/lib/utils/web.js:6-16), and the two disagreed:
//   - A duplicate `email` field: FormData.get() returns the FIRST value,
//     @auth/core's Object.fromEntries takes the LAST. An attacker sending
//     `email=decoy<N>@attacker.test&email=victim@example.com` bucketed the
//     proxy's throttle on a fresh decoy every request while @auth/core
//     authenticated against `victim@example.com` every time. Verified: 50/50
//     guesses got through, zero 429s (see the probe that was run before this
//     fix; both counts matched exactly).
//   - `Content-Type: application/json`: @auth/core parses JSON bodies fine;
//     `.formData()` throws on one, and proxy.ts's bare `catch {}` silently
//     dropped the entire per-account layer. Verified: 50/50 guesses got
//     through, zero 429s.
// Any middleware-side parser can drift from @auth/core again in the future
// (a new content-type, a body-parsing library upgrade, etc). The only way to
// make that structurally impossible is to stop parsing a second time at all:
// enforce the throttle at authorize() / resolveBasicAuth(), where the email
// has ALREADY been parsed by the code that is about to authenticate it.
//
// DESIGN CHOICE — when an account is over its failure limit, do we
// (a) reject the next attempt without verifying, or (b) still verify and
// let a correct password through? This module implements (b):
//
//   - There is also a SECOND, independent defect in the original feature:
//     the bucket was consumed on EVERY attempt, right or wrong, so anyone
//     who knew a user's email (or a CI account's, via HTTP Basic auth on
//     POST/DELETE /api/v1/api-keys) could lock that account out for the
//     life of every window, indefinitely, just by repeating the attack —
//     including against the workspace admin. Choice (a) does not fix this:
//     it blocks EVERY attempt once the limit is hit, right password or
//     wrong, so an attacker who merely knows the target's email can still
//     hold their account locked out forever by resubmitting one throwaway
//     guess per window.
//   - Choice (b) removes that lockout entirely: a correct password always
//     succeeds and immediately clears the account's failure counter,
//     regardless of how over-limit it was. That is what
//     recordLoginSuccess() below is for.
//   - The cost of (b): every attempt, throttled or not, still pays one
//     bcrypt compare — exactly what an ordinary, unthrottled login already
//     costs. This module does not amplify that cost.
//   - What this means honestly: once a WRONG guess is submitted, it was
//     ALWAYS going to be rejected, throttled or not — so for an account
//     already over its failure limit, being "throttled" makes no
//     observable difference to a wrong guess, and this module cannot, by
//     itself, hard-cap a determined, distributed (many-source-IP)
//     low-and-slow attacker's TOTAL guess count against one account — the
//     exact scenario the original per-account bucket was built to catch.
//     That capping now rests on src/proxy.ts's IP/circuit-breaker layer
//     (unchanged, still the volume brake) and on bcrypt's own per-guess
//     cost, neither of which is truly per-account. What this module still
//     buys: the failure counter can no longer be weaponized into a
//     targeted lockout, the enumeration-safety property is preserved (a
//     throttled account fails exactly the way an untthrottled wrong
//     password already did — no distinguishable signal), and
//     isThrottled()/recordLoginFailure()'s return value is available for
//     logging/alerting so a sustained attack against one account is at
//     least observable, even though it is no longer, alone, blockable
//     without reintroducing the lockout. There is no perfect answer here.

export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

type Bucket = { failureCount: number; resetAt: number };

// Deliberately NOT src/lib/rate-limit.ts's LRUCache. That cache is a fixed
// size-bounded LRU (max: 5_000) — fine for IP-keyed buckets (an untrusted
// caller collapses onto one shared circuit-breaker key, so there's nothing
// to flood) but wrong for a bucket keyed on a submitted EMAIL: the key is
// entirely attacker-chosen, and flooding an LRU with enough distinct keys
// evicts the least-recently-touched entry to make room for the newest one —
// including a victim's real, live bucket, silently resetting their attempt
// count back to zero. (Verified against the old shared LRUCache: flooding
// 5,000 distinct emails evicted a pre-existing victim key.) A bounded LRU is
// the wrong data structure for a limit whose key an adversary picks.
//
// This store never evicts a LIVE bucket to make room for a new one. Instead:
//   - a bucket naturally stops mattering once its window (`resetAt`) has
//     passed — that's ordinary TTL expiry, not adversarial eviction;
//   - a periodic sweep reclaims only EXPIRED entries, amortized across
//     writes, so long-idle keys don't pin memory forever;
//   - a hard ceiling exists purely to bound worst-case memory. Once hit, if
//     the sweep found nothing expired to reclaim (i.e. every live bucket is
//     still within its window), a brand-new identifier simply doesn't get a
//     bucket — its attempts go untracked until capacity frees up. An
//     existing identifier's bucket is NEVER evicted to make room; the worst
//     an attacker achieves by flooding past the ceiling is exempting their
//     OWN new throwaway identities from throttling, never a victim's.
const MAX_LIVE_BUCKETS = 20_000;
const buckets = new Map<string, Bucket>();

// Matches src/auth.ts's own normalization for the credentials-login email,
// used identically here so `Foo@Example.com` and `foo@example.com` (or
// values with incidental whitespace) share one bucket instead of doubling
// an attacker's effective attempt budget across two.
export function normalizeLoginIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type ThrottleStatus = { throttled: boolean; failureCount: number };

// Read-only peek at an identifier's current throttle state — does not
// record anything. Exposed mainly for logging/alerting call sites.
export function isThrottled(
  identifier: string,
  limit: number = LOGIN_FAILURE_LIMIT
): ThrottleStatus {
  const bucket = buckets.get(identifier);
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now) {
    return { throttled: false, failureCount: 0 };
  }
  return { throttled: bucket.failureCount >= limit, failureCount: bucket.failureCount };
}

// Records ONE failed login attempt against `identifier` and returns the
// resulting throttle status. Callers must only call this after confirming
// the attempt actually failed (wrong password, unknown account, etc) — a
// successful attempt must call recordLoginSuccess() instead, never this.
export function recordLoginFailure(
  identifier: string,
  limit: number = LOGIN_FAILURE_LIMIT,
  windowMs: number = LOGIN_FAILURE_WINDOW_MS
): ThrottleStatus {
  const now = Date.now();

  let bucket = buckets.get(identifier);
  if (!bucket || bucket.resetAt <= now) {
    if (!buckets.has(identifier) && buckets.size >= MAX_LIVE_BUCKETS) {
      sweepExpired(now);
      if (buckets.size >= MAX_LIVE_BUCKETS) {
        // At capacity and nothing expired to reclaim — refuse to create a
        // new bucket rather than evict a live one (see the design note
        // above). This identifier's attempts go unthrottled for now; no
        // existing identifier's state is touched.
        return { throttled: false, failureCount: 1 };
      }
    }
    bucket = { failureCount: 0, resetAt: now + windowMs };
    buckets.set(identifier, bucket);
  }

  // Mirrors src/lib/rate-limit.ts's rateLimit() semantics: the Nth failure
  // that brings the count exactly up to `limit` is still the caller's own
  // attempt and is reported as NOT throttled (limit=10 means 10 failures are
  // tolerated); only the (N+1)th failure, which finds the bucket already at
  // the limit, is reported as throttled. failureCount is intentionally
  // capped at `limit` rather than counting indefinitely upward — once
  // throttled, further failures don't change the reported state until the
  // window resets (or a success clears it).
  if (bucket.failureCount >= limit) {
    return { throttled: true, failureCount: bucket.failureCount };
  }
  bucket.failureCount += 1;
  return { throttled: false, failureCount: bucket.failureCount };
}

// Clears any recorded failures for `identifier` — call this the moment an
// attempt succeeds. This is what makes a correct password always work: even
// an account that was over its failure limit is fully reset the instant the
// right password is presented.
export function recordLoginSuccess(identifier: string): void {
  buckets.delete(identifier);
}

// Test-only: clears the whole store. `buckets` is a module-level singleton,
// so tests that share an identifier need this between cases the same way
// src/lib/rate-limit.ts's __resetRateLimitsForTests() works.
export function __resetLoginThrottleForTests(): void {
  buckets.clear();
}

// Test-only: exposes the live-bucket ceiling so tests can drive an eviction
// attack without hardcoding the constant twice.
export const __MAX_LIVE_BUCKETS_FOR_TESTS = MAX_LIVE_BUCKETS;
