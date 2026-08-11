import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockSessionRef } = vi.hoisted(() => ({
  mockSessionRef: { current: null as unknown },
}));

// src/proxy.ts is exported as `auth(handleProxy)` — NextAuth's
// middleware-wrapper form — rather than calling `await auth()` directly
// inside the handler. That's the CQ-119 fix: only the wrapper form lets
// NextAuth merge its own Set-Cookie (the refreshed claimsRefreshedAt JWT)
// onto whatever response the handler returns. This mock mirrors that shape:
// `auth(handler)` returns a function that stamps `request.auth` with
// whatever the current test put in mockSessionRef and then runs the handler,
// so tests read the same as before (set a session, call proxy()).
vi.mock("@/auth", () => ({
  auth:
    (handler: (req: NextRequest & { auth?: unknown }, ctx?: unknown) => unknown) =>
    async (req: NextRequest & { auth?: unknown }, ctx?: unknown) => {
      req.auth = mockSessionRef.current;
      return handler(req, ctx);
    },
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      count: vi.fn().mockResolvedValue(1),
    },
  },
}));

import { proxy } from "./proxy";
import { db } from "@/lib/db";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

const mockUserCount = db.user.count as ReturnType<typeof vi.fn>;

// vitest.config.ts sets mockReset: true, which resets every mock's
// implementation (not just its call history) before each test — including
// the db.user.count mock set once in the vi.mock() factory above. Without
// re-arming it here, count() would resolve to undefined after the first
// test, which proxy.ts reads as "no users yet" (initial setup) and redirects
// accordingly, breaking every later test in this file. Setting it in a
// file-level beforeEach (rather than baking it back into the vi.mock
// factory) keeps each test able to override it for setup-flow scenarios.
beforeEach(() => {
  mockUserCount.mockResolvedValue(1);
});

function setSession(session: unknown) {
  mockSessionRef.current = session;
}

function makeRequest(pathname: string) {
  return new NextRequest(new URL(`http://localhost${pathname}`));
}

const adminSession = { user: { id: "u1", isWorkspaceAdmin: true, mustChangePassword: false } };
const memberSession = { user: { id: "u2", isWorkspaceAdmin: false, mustChangePassword: false } };
const mustChangeSession = { user: { id: "u3", isWorkspaceAdmin: false, mustChangePassword: true } };

describe("proxy — mustChangePassword gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(null);
  });

  it("redirects to /change-password when mustChangePassword=true and not already there", async () => {
    setSession(mustChangeSession);
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/change-password");
  });

  it("does NOT redirect when already on /change-password", async () => {
    setSession(mustChangeSession);
    const res = await proxy(makeRequest("/change-password"));
    expect(res.status).toBe(200);
  });

  it("does NOT redirect when mustChangePassword=false", async () => {
    setSession(memberSession);
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(200);
  });

  it("redirects admin away from /admin when not workspace admin", async () => {
    setSession(memberSession);
    const res = await proxy(makeRequest("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("allows workspace admin to access /admin", async () => {
    setSession(adminSession);
    const res = await proxy(makeRequest("/admin"));
    expect(res.status).toBe(200);
  });
});

// CQ-124: /setup/settings toggles workspace-wide feature flags and used to
// have no gate at all once setup was complete — anyone who found the URL
// could open and save it. Mutation check (c): revert the
// `pathname === "/setup/settings"` clause in the admin-guard condition in
// src/proxy.ts and every test in this block must fail (they'd all see 200
// instead of a redirect).
describe("proxy — /setup/settings is locked once setup is complete (CQ-124)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(null);
  });

  it("redirects an unauthenticated visitor away from /setup/settings", async () => {
    setSession(null);
    const res = await proxy(makeRequest("/setup/settings"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects a signed-in non-admin away from /setup/settings", async () => {
    setSession(memberSession);
    const res = await proxy(makeRequest("/setup/settings"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("allows a workspace admin to reach /setup/settings", async () => {
    setSession(adminSession);
    const res = await proxy(makeRequest("/setup/settings"));
    expect(res.status).toBe(200);
  });
});

describe("proxy — rate limiting (no trusted proxy configured, the default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(null);
    __resetRateLimitsForTests();
  });

  // x-forwarded-for is set on these requests to simulate distinct callers,
  // but with TRUST_PROXY_HOPS unset (0, the default) it must be ignored —
  // that's the point of every test in this block.
  function makePostRequest(pathname: string, spoofedIp: string) {
    return new NextRequest(new URL(`http://localhost${pathname}`), {
      method: "POST",
      headers: { "x-forwarded-for": spoofedIp },
    });
  }

  function makeGetRequest(pathname: string, spoofedIp: string) {
    return new NextRequest(new URL(`http://localhost${pathname}`), {
      headers: { "x-forwarded-for": spoofedIp },
    });
  }

  it("does not rate-limit a GET to the same auth path", async () => {
    const res = await proxy(makeGetRequest("/api/auth/callback/credentials", `login-get-${Math.random()}`));
    expect(res.status).not.toBe(429);
  });

  // CQ-118 core property: a single client sending many requests must not be
  // able to make a different client's request fail. Mutation check (a):
  // replace clientIp()'s body with `return "x";` — every request (including
  // the spoofed x-forwarded-for above) then collapses onto the SAME per-IP
  // bucket sized for a single client (LOGIN_LIMIT=10), so "attacker"'s burst
  // exhausts it and "victim"'s very next request 429s. Under the real fix,
  // an untrusted client key fails open onto a shared circuit breaker sized
  // at 20x the per-client limit, so 10 requests from one caller never
  // affects a different caller.
  it("a burst from one client does not block a different client's login request", async () => {
    const attacker = `attacker-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      const res = await proxy(makePostRequest("/api/auth/callback/credentials", attacker));
      expect(res.status).not.toBe(429);
    }
    const victim = `victim-${Math.random()}`;
    const victimRes = await proxy(makePostRequest("/api/auth/callback/credentials", victim));
    expect(victimRes.status).not.toBe(429);
  });

  it("a burst from one client does not block a different client's v1 API request", async () => {
    const attacker = `attacker-${Math.random()}`;
    for (let i = 0; i < 120; i++) {
      const res = await proxy(makeGetRequest("/api/v1/test-cases", attacker));
      expect(res.status).not.toBe(429);
    }
    const victim = `victim-${Math.random()}`;
    const victimRes = await proxy(makeGetRequest("/api/v1/test-cases", victim));
    expect(victimRes.status).not.toBe(429);
  });

  // Rotating the spoofed header per request must not reset a shared counter
  // either — the fix isn't "trust the header", it's "don't key a
  // single-client-sized bucket off it".
  it("does not let a rotated spoofed IP escape the shared login circuit breaker", async () => {
    for (let i = 0; i < 200; i++) {
      const res = await proxy(makePostRequest("/api/auth/callback/credentials", `rotating-${Math.random()}`));
      expect(res.status).not.toBe(429);
    }
    const blocked = await proxy(
      makePostRequest("/api/auth/callback/credentials", `rotating-${Math.random()}`)
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("still bounds brute force via a shared circuit breaker once it's far above any single client's normal traffic", async () => {
    for (let i = 0; i < 2400; i++) {
      const res = await proxy(makeGetRequest("/api/v1/test-cases", `rotating-${Math.random()}`));
      expect(res.status).not.toBe(429);
    }
    const blocked = await proxy(makeGetRequest("/api/v1/test-cases", `rotating-${Math.random()}`));
    expect(blocked.status).toBe(429);
  });

  it("routes HTTP Basic auth on /api/v1/projects through the (fail-open, circuit-breaker-backed) login path, not the API bucket", async () => {
    // A distinct email per call, on top of the already-distinct spoofed IP —
    // this test is isolating the IP/circuit-breaker property (CQ-118). The
    // per-account failure throttle (CQ-128) no longer lives in proxy.ts at
    // all (see src/lib/login-throttle.test.ts and src/lib/api-auth.test.ts)
    // so it can't interfere with this test regardless of how many calls hit
    // the same account.
    function makeBasicAuthRequest(spoofedIp: string) {
      return new NextRequest(new URL("http://localhost/api/v1/projects"), {
        method: "POST",
        headers: {
          "x-forwarded-for": spoofedIp,
          authorization: `Basic ${Buffer.from(`user-${Math.random()}@b.com:pw`).toString("base64")}`,
        },
      });
    }
    for (let i = 0; i < 10; i++) {
      const res = await proxy(makeBasicAuthRequest(`basic-auth-${Math.random()}`));
      expect(res.status).not.toBe(429);
    }
    // Still under the login circuit breaker (200), unlike the old
    // per-IP-sized shared bucket which would already be exhausted here.
    const stillAllowed = await proxy(makeBasicAuthRequest(`basic-auth-${Math.random()}`));
    expect(stillAllowed.status).not.toBe(429);
  });

  it("does not rate-limit a Bearer-authed request to a Basic-auth-capable path", async () => {
    const res = await proxy(
      new NextRequest(new URL("http://localhost/api/v1/projects"), {
        headers: {
          "x-forwarded-for": `bearer-${Math.random()}`,
          authorization: "Bearer some-api-key",
        },
      })
    );
    expect(res.status).not.toBe(429);
  });
});

describe("proxy — rate limiting and clientIp with TRUST_PROXY_HOPS configured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(null);
    vi.resetModules();
  });

  async function importTrustedProxy() {
    process.env.TRUST_PROXY_HOPS = "1";
    const mod = await import("./proxy");
    return mod.proxy;
  }

  it("trusts the Nth-from-right XFF entry when TRUST_PROXY_HOPS=1, not the client-supplied leftmost one", async () => {
    const proxyWithTrustedHop = await importTrustedProxy();

    function makeReq(xff: string) {
      return new NextRequest(new URL("http://localhost/api/auth/callback/credentials"), {
        method: "POST",
        headers: { "x-forwarded-for": xff },
      });
    }

    // "chain.length - hops" = index 0 → the real client, as observed by the
    // one trusted proxy. An attacker can set the leftmost entry to anything;
    // it must be ignored.
    for (let i = 0; i < 10; i++) {
      const res = await proxyWithTrustedHop(makeReq("attacker-spoofed-value, real-client-ip"));
      expect(res.status).not.toBe(429);
    }
    const blocked = await proxyWithTrustedHop(makeReq("attacker-spoofed-value, real-client-ip"));
    expect(blocked.status).toBe(429);

    // A different attacker-supplied leftmost value with the SAME real
    // right-most entry must still hit the same (now-exhausted) bucket —
    // proving the leftmost value isn't part of the key.
    const stillBlocked = await proxyWithTrustedHop(
      makeReq("different-spoofed-value, real-client-ip")
    );
    expect(stillBlocked.status).toBe(429);

    delete process.env.TRUST_PROXY_HOPS;
  });

  it("gives each real client its own tight login bucket (10 / 5min) once the proxy is trusted", async () => {
    const proxyWithTrustedHop = await importTrustedProxy();

    function makeReq(pathname: string, ip: string) {
      return new NextRequest(new URL(`http://localhost${pathname}`), {
        method: "POST",
        headers: { "x-forwarded-for": ip },
      });
    }

    const clientA = `client-a-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      const res = await proxyWithTrustedHop(makeReq("/api/auth/callback/credentials", clientA));
      expect(res.status).not.toBe(429);
    }
    const aBlocked = await proxyWithTrustedHop(makeReq("/api/auth/callback/credentials", clientA));
    expect(aBlocked.status).toBe(429);

    // A different real client IP gets its own, untouched bucket.
    const clientB = `client-b-${Math.random()}`;
    const bAllowed = await proxyWithTrustedHop(makeReq("/api/auth/callback/credentials", clientB));
    expect(bAllowed.status).not.toBe(429);

    delete process.env.TRUST_PROXY_HOPS;
  });

  it("tracks login and v1 API limits independently for the same real client IP", async () => {
    const proxyWithTrustedHop = await importTrustedProxy();

    const ip = `separate-${Math.random()}`;
    function makePost(pathname: string) {
      return new NextRequest(new URL(`http://localhost${pathname}`), {
        method: "POST",
        headers: { "x-forwarded-for": ip },
      });
    }
    function makeGet(pathname: string) {
      return new NextRequest(new URL(`http://localhost${pathname}`), {
        headers: { "x-forwarded-for": ip },
      });
    }

    for (let i = 0; i < 10; i++) {
      await proxyWithTrustedHop(makePost("/api/auth/callback/credentials"));
    }
    const loginBlocked = await proxyWithTrustedHop(makePost("/api/auth/callback/credentials"));
    expect(loginBlocked.status).toBe(429);

    const apiStillAllowed = await proxyWithTrustedHop(makeGet("/api/v1/test-cases"));
    expect(apiStillAllowed.status).not.toBe(429);

    delete process.env.TRUST_PROXY_HOPS;
  });

  it("routes HTTP Basic auth on /api/v1/projects through the tight per-client login bucket, not the generous API bucket", async () => {
    const proxyWithTrustedHop = await importTrustedProxy();

    const ip = `basic-auth-${Math.random()}`;
    function makeBasicAuthRequest() {
      return new NextRequest(new URL("http://localhost/api/v1/projects"), {
        method: "POST",
        headers: {
          "x-forwarded-for": ip,
          authorization: `Basic ${Buffer.from("a@b.com:pw").toString("base64")}`,
        },
      });
    }
    for (let i = 0; i < 10; i++) {
      const res = await proxyWithTrustedHop(makeBasicAuthRequest());
      expect(res.status).not.toBe(429);
    }
    const blocked = await proxyWithTrustedHop(makeBasicAuthRequest());
    expect(blocked.status).toBe(429);
    // Confirms it hit the 10-per-5-min login bucket, not the 120-per-min API
    // bucket (which would still be far from its limit after 11 requests).

    delete process.env.TRUST_PROXY_HOPS;
  });
});
