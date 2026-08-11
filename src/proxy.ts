import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Credentials login attempts (email/password guessing) — tight window.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 5 * 60_000;

// CQ-128 used to also do per-ACCOUNT login limiting here, keyed on an email
// read from the request body. That account-bucket layer has moved to
// src/auth.ts's credentials authorize() and src/lib/api-auth.ts's
// resolveBasicAuth() — see src/lib/login-throttle.ts for why: reading the
// login body a SECOND time here (independent of @auth/core's own parser)
// let an attacker submit a body the two parsers disagreed on (a duplicate
// `email` field, or a JSON content-type body) and bucket the throttle on a
// different identity than the one actually being authenticated, bypassing
// it entirely (verified: 50/50 guesses got through both ways, zero 429s).
// Enforcing the check where the credentials are already parsed — once, by
// the same code that authenticates them — makes that drift structurally
// impossible. This file keeps only the IP/circuit-breaker volume brake
// below, which has no body to parse and so no equivalent bypass.
//
// Public v1 API — generous, sized for legitimate CI/automation traffic;
// exists to cap abuse and API-key guessing throughput, not everyday use.
const API_LIMIT = 120;
const API_WINDOW_MS = 60_000;

// CQ-118: when we can't tell clients apart (see clientIp below) we fail open
// on per-client limiting rather than collapsing every client into one bucket
// sized for a SINGLE client. Instead we run a coarse, shared circuit breaker
// at a much higher threshold, purely to bound an outright flood — not to
// enforce per-user fairness, which is impossible without a real identity.
const UNPROXIED_CIRCUIT_MULTIPLIER = 20;
const LOGIN_CIRCUIT_LIMIT = LOGIN_LIMIT * UNPROXIED_CIRCUIT_MULTIPLIER; // 200 / 5min
const API_CIRCUIT_LIMIT = API_LIMIT * UNPROXIED_CIRCUIT_MULTIPLIER; // 2400 / min

// Number of reverse proxies in front of this app that are trusted to set
// X-Forwarded-For correctly (nginx, Caddy, a load balancer, etc). Defaults to
// 0 — matching this app's docker-compose deployment, which publishes the app
// port directly with nothing in front of it. X-Forwarded-For is a plain
// request header: with no trusted proxy, any client can set it to anything,
// so trusting it (even just the first entry) lets an attacker rotate it per
// request and defeat the limiter entirely. Set TRUST_PROXY_HOPS to the
// number of proxy hops between the internet and this app to enable real
// per-client limiting. See CQ-105 / CQ-118 in CLAUDE.md and docker-compose.yml
// for what happens when this is left unset.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 0) || 0;

// Returns a per-client identity to key a rate-limit bucket on, or `null` when
// no such identity can be trusted. `NextRequest` exposes no raw socket
// address in Next.js middleware (there is no `request.ip` — Next removed it,
// and self-hosted/docker-compose deployments have no platform layer to
// inject one), so the only candidate is X-Forwarded-For / X-Real-IP, and
// those are plain attacker-settable headers unless a configured number of
// trusted proxy hops wrote them. `null` means "no trustworthy per-client key
// exists for this request" — callers must NOT fall back to a single shared
// per-client-sized bucket (that was CQ-118: 11 requests from anyone 429s
// EVERY user's login, repeatably). See checkRateLimit for the fallback.
function clientIp(request: NextRequest): string | null {
  if (TRUST_PROXY_HOPS > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      // Each hop a request passes through appends the IP it saw the request
      // arrive from, so the header reads "client, proxy1, proxy2, ...".
      // Only the entry written by the innermost trusted proxy — counted
      // from the right — was not attacker-suppliable. Anything to its left
      // (including a naive .split(",")[0]) is still client-controlled even
      // behind a real proxy.
      const chain = forwarded.split(",").map((ip) => ip.trim()).filter(Boolean);
      const index = chain.length - TRUST_PROXY_HOPS;
      if (index >= 0) return chain[index];
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp;
  }
  // No trusted proxy configured (or one is configured but didn't write the
  // headers it was expected to) — headers are not a trustworthy identity.
  return null;
}

// CQ-118: picks the per-client bucket when clientIp() can identify one, and
// falls back to a shared, much coarser circuit-breaker bucket otherwise.
// Tradeoff: the circuit breaker cannot distinguish clients, so a single
// client sustaining traffic at LOGIN_CIRCUIT_LIMIT / API_CIRCUIT_LIMIT scale
// can still trip it and briefly affect other clients — but that only
// happens under an actual flood far above normal traffic, not from any one
// client merely bumping into the tight per-client limits (10 / 5min,
// 120 / min), which is what made the old shared-bucket fallback a
// self-inflicted, repeatable workspace-wide outage. Configuring
// TRUST_PROXY_HOPS restores real, fair per-client limiting.
function checkRateLimit(
  bucket: "login" | "api",
  request: NextRequest,
  limit: number,
  windowMs: number,
  circuitLimit: number
) {
  const ip = clientIp(request);
  if (ip === null) {
    return rateLimit(`${bucket}:__circuit__`, circuitLimit, windowMs);
  }
  return rateLimit(`${bucket}:${ip}`, limit, windowMs);
}

function tooManyRequests(retryAfterMs: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
  );
}

// Set-once cache: once a workspace admin exists, it's permanent (last-admin guard
// prevents deleting the only admin). No TTL needed.
let setupComplete = false;

// Paths that bypass all redirect rules
const PUBLIC_PATHS = new Set(["/login", "/api/auth"]);
const SETUP_PATHS = new Set(["/setup", "/setup/settings"]);
const SETUP_API_PATHS = new Set(["/api/setup"]);
const STATIC_PREFIXES = ["/_next/", "/favicon.ico", "/api/auth/"];
// v1 routes that accept HTTP Basic auth (email+password) — see resolveBasicAuth
// in src/lib/api-auth.ts. Rate-limited via the login bucket, not the API bucket.
const BASIC_AUTH_PATHS = new Set(["/api/v1/projects", "/api/v1/api-keys"]);
const CHANGE_PASSWORD_PATH = "/change-password";

function isStaticOrPublic(pathname: string): boolean {
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PUBLIC_PATHS.has(pathname)) return true;
  return false;
}

async function handleProxy(request: NextAuthRequest, _event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // Rate-limit brute-force-able entry points before anything else — must run
  // ahead of the static/public bypass below, since /api/auth/ is in there.
  //
  // BASIC_AUTH_PATHS accept a raw email+password via HTTP Basic auth
  // (src/lib/api-auth.ts resolveBasicAuth) to mint an API key — a password
  // guessing surface exactly like the credentials login, so it must share
  // the tight login bucket rather than the generous per-minute API bucket
  // below (which exists for authenticated CI/automation traffic, not for
  // throttling password guesses).
  const isCredentialsLogin =
    pathname === "/api/auth/callback/credentials" && request.method === "POST";
  const isBasicAuthEndpoint =
    (BASIC_AUTH_PATHS.has(pathname) || pathname.startsWith("/api/v1/api-keys/")) &&
    request.headers.get("authorization")?.startsWith("Basic ");
  if (isCredentialsLogin || isBasicAuthEndpoint) {
    const result = checkRateLimit("login", request, LOGIN_LIMIT, LOGIN_WINDOW_MS, LOGIN_CIRCUIT_LIMIT);
    if (!result.allowed) {
      return tooManyRequests(result.retryAfterMs, "Too many login attempts. Try again later.");
    }
    // Per-account failure throttling happens downstream, once, where the
    // credentials are already parsed — see src/lib/login-throttle.ts.
  }
  if (pathname.startsWith("/api/v1/")) {
    const result = checkRateLimit("api", request, API_LIMIT, API_WINDOW_MS, API_CIRCUIT_LIMIT);
    if (!result.allowed) {
      return tooManyRequests(result.retryAfterMs, "Rate limit exceeded.");
    }
  }

  // Always allow static assets and auth routes
  if (isStaticOrPublic(pathname)) return NextResponse.next();

  // Check setup completion (set-once cache)
  if (!setupComplete) {
    try {
      const adminCount = await db.user.count({ where: { isWorkspaceAdmin: true } });
      if (adminCount > 0) setupComplete = true;
    } catch {
      // DB unavailable — treat as not set up, allow through to /setup
    }
  }

  // Setup gate: if no workspace admin exists, redirect everything to /setup
  // (except /setup itself, /setup/settings, and the setup API)
  if (!setupComplete) {
    if (
      !SETUP_PATHS.has(pathname) &&
      !SETUP_API_PATHS.has(pathname)
    ) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
    return NextResponse.next();
  }

  // Setup lockout: /setup (step 1 only) is inaccessible once setup is done.
  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Session for this request. `request.auth` is populated by the `auth()`
  // wrapper this module is exported through (see the bottom of this file) —
  // it has already decoded the JWT and, per CLAIM_REFRESH_INTERVAL_MS in
  // src/auth.ts, may have hit the DB to refresh isWorkspaceAdmin /
  // mustChangePassword if more than ~60s had passed since the last refresh
  // (CQ-123: this used to say "no DB call", which stopped being true once
  // that refresh was added). Wrapping with auth() rather than calling it
  // directly is what CQ-119 required: only the wrapper form lets NextAuth's
  // Set-Cookie (the updated claimsRefreshedAt) merge onto our response, so
  // the throttle actually persists instead of silently re-querying the DB on
  // every request.
  const session = request.auth;

  // Admin guard: /admin/** requires isWorkspaceAdmin in session. /setup/settings
  // is workspace-config UI (feature flags) and must be locked the same way
  // once setup is complete (CQ-124) — it used to have no gate at all here and
  // the page itself never called auth() either, so anyone could open it.
  if (
    (pathname.startsWith("/admin") || pathname === "/setup/settings") &&
    !session?.user?.isWorkspaceAdmin
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // mustChangePassword gate: redirect everywhere except /change-password itself
  if (session?.user?.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
  }

  return NextResponse.next();
}

// `auth` (from src/auth.ts, i.e. next-auth's NextAuth() result) is typed as
// an intersection of five call signatures — one per calling convention
// (RSC, API routes, getServerSideProps, App Route handlers, middleware; see
// NextAuthResult["auth"] in next-auth's index.d.ts). TS's overload
// resolution for a plain (req, event) callback like handleProxy is
// ambiguous between the App Route handler and middleware signatures, and
// picks the wrong one. Assert the single signature we actually want — the
// documented "wrap your own middleware with auth(...)" form — rather than
// fight the overload resolution; this is a type-only cast, the underlying
// function is unchanged.
const authedProxy = (auth as (mw: typeof handleProxy) => typeof handleProxy)(handleProxy);

// `event` is optional here (NextMiddleware's isn't) purely so tests can call
// `proxy(request)` directly without a real NextFetchEvent — Next.js's own
// runtime adapter always supplies one.
export async function proxy(request: NextRequest, event?: NextFetchEvent) {
  return authedProxy(request as NextAuthRequest, event as NextFetchEvent);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
