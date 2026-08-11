# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Also check AGENTS.MD file for further guidance.

## Commands

```bash
# Development
npm run dev              # Next.js dev server
npm run build            # Production build
npm run lint             # ESLint
npx tsc --noEmit         # TypeScript check

# Database (Prisma)
npx prisma generate      # Regenerate client after schema changes
npx prisma db push       # Sync schema to DB (no migration files)
npx prisma studio        # GUI browser

# Testing (Vitest)
npx vitest run                              # All tests
npx vitest run src/lib/foo.test.ts          # Single file
npx vitest run -t "pattern"                 # By pattern (Vitest's CLI has no --grep)
npx vitest run --coverage                   # With coverage

# Note: vitest.config.ts sets mockReset: true — mocks must be armed per-test
# in beforeEach(), not in vi.mock() factory, since factory-time mockResolvedValue
# gets wiped at the start of each test.
```

## Local Development Setup

1. Copy `.env.example` to `.env`
2. Start DB: `docker compose -f docker-compose.dev.yml up -d`
3. Run `npx prisma generate && npx prisma db push`
4. Run `npm run dev`

For full stack (DB + app + migrations): `docker compose up --build -d`

## Architecture

**Next.js App Router** with server components by default. `"use client"` only for interactive components (useState, useEffect, browser hooks).

```
src/
├── proxy.ts                             # Every auth/rate-limit gate in the app (see below)
├── auth.ts                              # NextAuth v5 config (JWT strategy) — NOT src/lib/auth.ts
├── app/
│   ├── page.tsx / login/ / register/   # Auth pages
│   ├── dashboard/[projectId]/          # Per-project routes (tests, metrics, settings)
│   ├── (report)/report/runs/[runId]/   # Print-friendly report route group
│   └── api/
│       ├── v1/runs/                    # Public REST API (API key auth)
│       ├── auth/                       # NextAuth + registration
│       └── ...                         # Internal CRUD routes
├── components/
│   ├── ui/                             # Base UI wrappers (Button, Dialog, etc.)
│   ├── tests-panel.tsx                 # Manual test execution UI
│   ├── metrics-panel.tsx               # Dashboard charts
│   └── active-run-panel.tsx / run-report.tsx / settings-panel.tsx
├── lib/
│   ├── db.ts                           # Prisma singleton — always import from here
│   ├── rate-limit.ts                   # In-process fixed-window limiter used by src/proxy.ts
│   ├── login-throttle.ts               # Per-account failed-login-attempt throttle
│   ├── api-auth.ts                     # API key auth + HTTP Basic auth for v1 routes
│   ├── api-pagination.ts               # Shared ?limit= parsing for v1 list routes
│   ├── api-formatters.ts               # v1 response shaping + Prisma include shapes
│   ├── projects.ts                     # ensureProjectForUser() — auto-provisions on first login
│   ├── project-membership.ts           # findNonMemberIds() — shared tenant/assignee validation
│   ├── metrics.ts                      # getProjectMetrics() — single source for dashboard + v1
│   ├── flaky-detection.ts              # Flaky test detection across last 5 runs
│   ├── failure-category.ts             # Failure categorization logic
│   ├── junit.ts                        # JUnit XML parsing
│   ├── csv.ts                          # CSV escaping + formula-injection defence
│   └── test-case-ids.ts                # TC-0001 style ID generation
├── types/                              # Shared TypeScript types
prisma/schema.prisma                    # Single source of truth for DB schema
```

## Key Patterns

### Auth & Authorization
- `await auth()` in server components to get the session
- Always verify the user is a `ProjectMember` before any project mutation
- `src/auth.ts` uses credentials (email/password + bcrypt) with JWT sessions; per-account
  login-attempt throttling lives in `authorize()` here (via `src/lib/login-throttle.ts`)
- Public API (`/api/v1/`*) uses bearer API keys hashed in the `api_keys` table; per-account
  throttling for HTTP Basic auth lives in `resolveBasicAuth()` (`src/lib/api-auth.ts`)
- `src/proxy.ts` is where every request-level gate actually lives — the
  setup-completion redirect, the `/admin` + `/setup/settings` admin guard,
  the `mustChangePassword` redirect, and IP/circuit-breaker rate limiting
  (see `TRUST_PROXY_HOPS` below)

### Data Model Highlights
- `Project` has `testCasePrefix` + `testCaseCounter` for sequential display IDs (e.g. `TC-0001`)
- `TestRun` has `source: MANUAL | AUTOMATED` and `status: IN_PROGRESS | COMPLETED | ABORTED`
- `TestResult` links to optional `TestCase` (manual) and has `FailureCategory` enum for automated failures
- `TestSuite` is an ordered collection of `TestCase` records (via `TestSuiteCase` junction)
- Feature flags `ENABLE_SESSION_TESTING` and `ENABLE_RELEASE_TRACKING` gate UI sections

### Styling & UI
- Tailwind CSS v4 for all styling; use `cn()` from `@/lib/utils` for conditional classes
- UI primitives from `@base-ui/react`, wrapped in `src/components/ui/`
- Forms: `react-hook-form` + `@hookform/resolvers/zod`
- Notifications: `toast()` from `sonner`
- Charts: `recharts`

### Naming Conventions
- Files/dirs: `kebab-case`
- Components: `PascalCase`
- Functions/vars: `camelCase`
- DB tables: `snake_case` via `@@map()`
- Enums: `SCREAMING_SNAKE_CASE`

### API Routes
- Internal: `src/app/api/<resource>/route.ts` — session-authenticated
- Public v1: `src/app/api/v1/<resource>/route.ts` — bearer API key authenticated
  - `runs/` — list, get, ingest (automated test results)
  - `test-cases/` — list, get, create, update, delete, bulk create
  - `test-suites/` — list, get, create, update, delete, add/remove cases (cursor pagination)
  - `bugs/` — list, get, create; `[id]/` — update; `[id]/reopen/` — reopen
  - `defect-reports/` — list, create (log reports)
  - `metrics/` — get project metrics
  - `api-keys/` — create (via Basic auth), list (for the authenticated user)
- Zod for request validation; return `NextResponse.json({ error }, { status })` on failures

## Environment Variables

Required in `.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — NextAuth secret (`openssl rand -base64 32`)
- `NEXTAUTH_URL` — App URL (default: `http://localhost:3000`)
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — used by docker-compose

Feature flags (default `false`): `ENABLE_SESSION_TESTING`, `ENABLE_RELEASE_TRACKING`

Optional (rate limiting):
- `TRUST_PROXY_HOPS` — number of reverse proxy hops in front of this app that
  are trusted to set `X-Forwarded-For` correctly (default `0`, matching the
  default `docker-compose.yml` deployment, which publishes the app port
  directly). IP-based rate limiting in `src/proxy.ts` requires this: left at `0`,
  the app cannot trust per-client headers and falls back to a coarse, shared
  circuit breaker (volume brake only, not per-client fairness) to avoid
  self-DoS on normal traffic. Set it to the number of real proxy hops (usually `1`)
  once a reverse proxy sits in front of this app to get real per-client IP limiting.
  Per-account login/API-key throttling lives separately in `src/lib/login-throttle.ts`
  and `src/lib/api-auth.ts` and does not depend on `TRUST_PROXY_HOPS`.

## Commit Style

Follow [gitmoji](https://gitmoji.dev/) + imperative mood. Branch naming: `feature/<description>` or `fix/<issue-number>`.
