# TODOS

Deferred work, highest priority first. Two sources so far:

- `/plan-ceo-review`, 2026-03-24 — v1 REST API full CRUD expansion.
- The v0.7.0.0 release, 2026-08-11 — gaps left open by the audit remediation.

Entries marked *partially shipped* describe only what still remains; the
part that shipped is summarised inline so the residue stays legible.

---

## P1 — Deploy Path Uses `prisma db push`, Not Migrations

**What:** `docker-compose.yml` line 69 runs `npx prisma db push` instead of `npx prisma migrate deploy`.
Migration files exist in `prisma/migrations/` (e.g. `20260811120000_add_exploratory_session_project_fk/migration.sql`)
but are not wired into the deploy path. The most recent migration adds a foreign-key constraint to
`exploratory_sessions.projectId` with a pre-flight `DELETE` to clean up orphan rows. If any orphan
rows exist in production, the `ADD CONSTRAINT` will fail and the entire deploy (app startup) will fail.

**Why:** Using `db push` (schema-based) instead of `migrate deploy` (history-based) means
migrations are authored but not executed. This works fine until a migration contains a
constraint that cannot be added to pre-existing orphan data. The migration file explicitly
documents this risk with comments and a cleanup `DELETE`, but that cleanup is unreviewed and
will silently delete data.

**Risk:** A deploy will fail hard if an orphan row exists. Recovery requires either: (1) backing up
and running the cleanup manually, (2) rolling back the schema change, or (3) restoring from backup.

**Where to start:** Decide: stick with `db push` (simpler for this app's self-hosted scale, but
risky on schema changes) or migrate to `migrate deploy` (add a migrations table, wire the deploy
step). If keeping `db push`, add a pre-flight validation step to the deploy: check for orphans,
report them, and halt if any are found. If switching to migrations, audit the migration file
before deploying — the `DELETE` in `20260811120000_*` is the default policy and may need revision
for your data.

**Effort:** M (human: ~4 hours for full migration setup / CC: ~1 hour for pre-flight check only)
**Depends on:** None — decision on deploy strategy

---

## P2 — E2E Test: Admin Invite + Forced Password Reset Flow

**What:** End-to-end test covering the full admin invite journey: admin creates a user
account → user logs in with the temp password → middleware redirects to `/change-password`
→ user sets a new password → signs out → re-logs in successfully with the new credentials.

**Why:** Unit tests cover each route in isolation (POST /api/admin/users, PATCH
/api/auth/change-password), but no test verifies the complete JWT-through-middleware
integration. A shape mismatch between `auth.ts` callbacks and the middleware session
check would pass all unit tests but fail in the browser. This flow is high-value and
straightforward to automate.

**Where to start:** Set up Playwright (`npm install -D @playwright/test`, add
`playwright.config.ts`). Write one spec file: `e2e/admin-invite.spec.ts`. Seed DB
with a workspace admin account, run the full flow, assert that the /dashboard is
reachable after password reset with the new credentials.

**Effort:** M (human: ~4h setup + test / CC: ~15min)
**Depends on:** Admin invite + forced password reset feature shipped (see design doc
`dnpi-master-design-20260325-150025.md`)

---

## P2 — Webhooks

**What:** Emit HTTP POST events to a caller-configured URL when key events happen
(`run.completed`, `test_case.created`, `suite.updated`, etc.), with HMAC-SHA256
signature verification and retry-with-backoff.

**Why:** Eliminates polling for event-driven integrations. Enables Slack notifications,
Jira ticket updates, and downstream pipeline triggers without writing polling loops.
Transforms itgrate from a data store into an event source.

**Where to start:** Add a `Webhook` model to the schema (`projectId`, `url`, `secret`,
`events: String[]`). Add a `WebhookDelivery` model for delivery tracking. On each
triggering event, queue a delivery. Delivery worker: HTTP POST with body +
`X-Itgrate-Signature: sha256=<HMAC>`. Retry up to 3× with exponential backoff.

**Effort:** L (human: ~1 week / CC: ~2 hours)
**Depends on:** v1 API shipped and in active use

---

## P2 — OpenAPI Spec + Interactive Docs

**What:** Generate `openapi.yaml` from the working v1 implementation, serve an
interactive playground at `/api/v1/docs` (Scalar or Swagger UI).

**Current v1 surface:** 16 route.ts files under `src/app/api/v1/` covering: api-keys
(create, list, get, delete), bugs (list, get, create, update, reopen), defect-reports
(list, create), metrics (get), projects (list), runs (list, ingest, get), test-cases
(list, create, get, update, delete, bulk create), test-suites (list, create, get,
update, delete, add/remove cases).

**Why:** Enables SDK auto-generation in any language, gives integrators a testable
playground, and creates a formal contract for breaking-change detection in CI.

**Where to start:** After endpoints are stable, use `zod-to-openapi` or
`next-openapi-route-handler` to generate the spec from existing Zod schemas.
Alternatively, hand-write the spec post-shipping and validate it against live responses.

**Effort:** M (human: ~3 days / CC: ~1 hour)
**Depends on:** v1 API shipped and stable

---

## P3 — Rate Limit Email Lookup Endpoint

**What:** Cap calls to `GET /api/projects/[projectId]/members/lookup?email=...` per
user per minute. Any project admin can confirm whether an arbitrary email exists in the
workspace by calling this endpoint repeatedly.

**Why:** Exact email lookup reduces enumeration vs. autocomplete, but doesn't eliminate
it. A determined caller can still enumerate the workspace user list one email at a time.

**Status:** Unblocked. Rate limiting infrastructure now exists in `src/lib/rate-limit.ts`.

**Where to start:** The endpoint lives at `src/app/api/projects/[projectId]/members/lookup/route.ts`
and currently has no rate limiting. Apply `rateLimit()` from `src/lib/rate-limit.ts` using the
session user's ID as the bucket key — similar to how login throttling works in `src/lib/login-throttle.ts`.
The lookup endpoint is the highest-value target given it's accessible to project admins (a broader
group than workspace admins).

**Effort:** S (human: ~30 min / CC: ~5 min)
**Depends on:** None — infrastructure shipped

---

## P3 — Rate Limiting

**Status:** PARTIALLY SHIPPED. Infrastructure now exists; work remains to complete the feature.

**What:** `src/lib/rate-limit.ts` is an in-process fixed-window limiter. `src/proxy.ts` applies
it to credentials login (10 per 5 min) and `/api/v1/*` (120 per min), both keyed by **client IP**
with a shared circuit-breaker fallback when `TRUST_PROXY_HOPS` is unset. `src/lib/login-throttle.ts`
adds per-account failed-login throttling (10 failures per 15 min) that counts only failed attempts
and clears on success. 429 responses carry `Retry-After`.

**What remains:**
- Limits are keyed by **IP, not per API key** — the original spec called for per-key limits but
  the implementation is IP-based. API key-based limits would require a separate per-key bucket.
- The store is **in-process**, so limit buckets multiply by replica count and reset on restart.
  A shared store (Redis, Upstash, etc.) is still needed for multi-instance deployments.
- `/api/admin/*` routes are still **not** rate limited — they accept session auth but have no
  dedicated rate limit applied.

**Where to start:** To complete: (1) decide whether API key-based limits matter for this app's
deployment model; if yes, add a per-key bucket via `rateLimit()` in `src/lib/api-auth.ts`'s
`resolveApiKey()` path; (2) migrate the in-process store to Redis for multi-instance support
(the infrastructure in `rateLimit()` is abstract to the store); (3) add rate limiting to
`/api/admin/*` routes via `checkRateLimit()` in `src/proxy.ts`.

**Effort:** M (human: ~1 day / CC: ~30 min)
**Depends on:** None — infrastructure now exists.

---

## P3 — Personal Access Tokens (PATs)

**What:** Replace HTTP Basic Auth on `/api/v1/projects` and `/api/v1/api-keys` with
user-scoped PATs — long-lived tokens independent of the user's password, manageable
via UI, rotatable without a password change.

**Why:** Basic Auth is tied to login credentials. If itgrate supports team accounts,
service accounts, or SSO, Basic Auth becomes a security liability (shared email+password
for CI pipelines). PATs decouple automation credentials from personal logins.

**Where to start:** New `PersonalAccessToken` model (userId, name, tokenHash, scope,
lastUsedAt, expiresAt). UI in settings panel to create/revoke. Update `resolveBasicAuth`
to also accept PAT Bearer tokens. Backward-compatible — existing Basic Auth continues
to work during migration.

**Trigger:** If teams start sharing email+password credentials for CI/CD pipelines,
that's the signal to prioritize this.

**Effort:** L (human: ~1 week / CC: ~1 hour)

---

## ~~P2 — Error Handling in proxy.ts Setup Check~~ Fixed by /qa on master, 2026-04-08

Fixed in commit `76c9dc4`. The `db.user.count()` call in `src/proxy.ts` is now wrapped
in try/catch. On Prisma error, `setupComplete` stays `false` and requests redirect to
`/setup` rather than crashing with 500.

---

## P3 — Admin API JWT Re-validation

**Status:** LARGELY SHIPPED. Per-request re-validation now exists but with a residual gap.

**What:** `src/auth.ts` re-reads `isWorkspaceAdmin` and `mustChangePassword` from the database
in the `jwt` callback on a ~60 second interval (`CLAIM_REFRESH_INTERVAL_MS = 60_000`), and clears
the privilege claims when the user row no longer exists.

**Staleness window:** Now about 60 seconds rather than the JWT lifetime (previously an accepted
trade-off, now substantially tighter).

**Residual work:** The token's `id`, `sub`, and `email` claims still survive after user deletion.
A deleted user can still satisfy a plain `session?.user?.id` check on non-admin routes — this is
not an immediate concern on self-hosted scale but is a gap. A `tokenVersion` field or an
existence check at the trusted boundary (`src/proxy.ts`) would close it completely.

**Effort:** S (human: ~2 hours / CC: ~10 min)
**Depends on:** None — re-validation already shipped

---

## P2 — Login page 500 when DB is unavailable

**What:** `src/app/login/page.tsx` calls `getFeatureFlags()` which hits `db.workspaceSettings.findFirst()`.
When the DB is unreachable, the page throws an unhandled Prisma error and returns 500.

**Why:** The login page should be accessible even during brief DB outages — it's the
primary recovery path for users. Other pages that need flags (dashboard, etc.) crashing
is acceptable, but the login page should degrade to safe defaults.

**Fix:** Wrap `getFeatureFlags()` in `src/lib/feature-flags.ts` in a try/catch and return
default flag values on failure. Zero functional risk — defaults are all `false`.

**Effort:** XS (human: ~15 min / CC: ~2 min)
**Found by:** `/qa` on master, 2026-04-08

---

## P2 — `TRUST_PROXY_HOPS` Unset Weakens Login Rate Limiting

**What:** With `TRUST_PROXY_HOPS` unset (the default, and the documented docker-compose
deployment model in `docker-compose.yml`), `src/proxy.ts` cannot trust any per-client header.
All clients share a single, coarse circuit-breaker bucket for login attempts (200 per 5 minutes
across all users). This means a single attacker can generate enough traffic to trip the shared
breaker and temporarily lock out every user's login, including the workspace admin.

**Measured impact:** Roughly one request every 1.5 seconds is enough to keep every user's login
returning 429, even legitimate users.

**Why:** `X-Forwarded-For` is a plain request header; an untrusted client can set it to any value.
Setting `TRUST_PROXY_HOPS > 0` tells the app to trust the rightmost N entries (written by the
innermost N proxies), but only when a real proxy is actually in front of the app. Leaving it at 0
is safe for direct deployments but sacrifices per-client fairness.

**Where to start:** If deploying behind a reverse proxy (nginx, Caddy, load balancer), set
`TRUST_PROXY_HOPS=1` (or higher if there are multiple proxy layers). The `docker-compose.yml`
comment on line 46-52 explains the tradeoff. Per-account login throttling in `src/lib/login-throttle.ts`
is unaffected and remains fair (10 failures per 15 min per email), so this is primarily a volume brake.

**Effort:** XS (human: ~5 min / CC: ~2 min)
**Depends on:** None — configuration only

---

## P2 — No Component Tests

**What:** There are no `.test.tsx` files in `src/components/`, and `package.json` has no
`@testing-library/react`, `jsdom`, or `happy-dom` dependencies. `vitest.config.ts` sets
`environment: "node"`, so even if tests existed, they would run in Node, not a DOM environment.

**Impact:** Recent fixes to `src/components/active-run-panel.tsx` and `src/components/bugs-panel.tsx`
that addressed silent-data-loss behaviour are verified only by code review and manual testing,
not automated tests. Browser-specific bugs (React re-render, event handler edge cases, state
mutation) are not caught until production.

**Why:** Component testing requires a DOM environment and React-specific assertions. The infrastructure
has not been set up, likely deferred pending stability on core API logic (which has unit test coverage).

**Where to start:** Add `@testing-library/react`, `jsdom` (or `happy-dom`), and update `vitest.config.ts`
to use `environment: "jsdom"`. Write `.test.tsx` files for: (1) `active-run-panel.tsx` — verify the
silent data loss fix (test that the state doesn't mutate when results arrive); (2) `bugs-panel.tsx` —
similar test for that component. Use `render()` from `@testing-library/react`, `screen.getByRole()`,
and `userEvent` for interactions.

**Effort:** M (human: ~8 hours to set up + write 2-3 solid tests / CC: ~2 hours)
**Depends on:** None — can start immediately

---

## P3 — Registration Endpoint Is a User-Enumeration Oracle

**What:** `src/app/api/auth/register/route.ts` returns HTTP 409 ("email already exists") when
a user submits an email that is registered, and HTTP 201 otherwise. This endpoint is unauthenticated
and not rate limited (it only checks `openRegistration` feature flag). An attacker can submit emails
one at a time and learn the full user roster via the status code alone.

**Why:** Exact email confirmation is a user-enumeration vector. OWASP recommends returning the same
response (201, with a generic message) whether the email is registered or not, or declining to register
at all when `openRegistration` is false. Returning 409 distinguishes the two cases.

**Scope:** Only reachable when `openRegistration` feature flag is enabled. Self-hosted instances
likely keep this off, but it's a trap for instances that enable it.

**Where to start:** Option (a): unify the response — return 201 and a generic success message regardless
of whether the email existed. Include the instructions ("check your email to confirm") so the user
experience doesn't change; a real validation email is never sent, so the confusion is internal.
Option (b): check `openRegistration` before the user submits anything and reject registration entirely
if it's off. This removes the endpoint as an enumeration oracle but also breaks the feature. Option (a)
is safer.

**Effort:** S (human: ~1 hour / CC: ~10 min)
**Depends on:** None — fix only

---

## P3 — MCP `create_bug` Advertises Far Fewer Fields Than It Accepts

**What:** The MCP tool definition for `create_bug` in `mcp-server/src/tools/bugs.ts` has two
separate schemas: the advertised `inputSchema.properties` (lines 134-143, ~8 fields: title,
description, severity, detectionPhase, rootCause, priority, environment, isRegression) and the
Zod validator `CreateBugInput` (lines 17-55, ~26 fields: all of the above plus external_issue_id,
issue_tracker_url, module_name, sprint, release, fixVersion, bugType, detectionSource,
assignedDeveloperId, responsibleQaId, clientImpact, businessImpact, reproductionSteps,
expectedResult, actualResult, notes, labels, firstDetectedDate).

**Problem:** A client relying on the advertised schema cannot discover the 18 additional fields
and will miss them. The Zod validator accepts all 26, so the API will happily ingest them if sent,
but a code-generating client (or a user reading the schema) has no signal to include them.

**Secondary issue:** `update_bug` has a similar but smaller mismatch, and cannot change
`external_issue_id` or `issue_tracker_url` at all — those fields are not in `UpdateBugInput`.

**Where to start:** Sync the advertised `inputSchema` with the Zod validator. Add the 18 missing
fields to the `inputSchema.properties` block (lines 134-143) so clients can discover them. For
`update_bug`, either extend `UpdateBugInput` to allow updating `external_issue_id` and
`issue_tracker_url`, or document why they are immutable.

**Effort:** S (human: ~30 min / CC: ~5 min)
**Depends on:** None — schema cleanup only
