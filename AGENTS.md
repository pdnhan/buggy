# AGENTS.md - Repository Guide for AI Agents

Welcome to **itgrate-test-management**, a test management platform for QA teams. This document provides essential information for navigating and contributing effectively.

---

## 1. Build, Lint, and Test Commands

### Development
- `npm run dev` — Start Next.js development server
- `npm run build` — Build for production
- `npm run start` — Run production build

### Linting & Type Checking
- `npm run lint` — Run ESLint (eslint-config-next)
- `npx tsc --noEmit` — TypeScript verification

### Database (Prisma)
- `npx prisma generate` — Update `@prisma/client` types after schema changes
- `npx prisma db push` — Sync schema to database (fast, no migrations)
- `npx prisma studio` — GUI database browser
- `node dist/check-db.js` — Check DB connectivity

### Testing (Vitest)
- `npx vitest run` — Run all tests
- `npx vitest run src/lib/foo.test.ts` — Run single test file
- `npx vitest run -t "pattern"` — Run tests matching pattern (Vitest's CLI has no `--grep`)
- `npx vitest run --coverage` — Run with coverage

**Note on mocks:** `vitest.config.ts` sets `mockReset: true`, so mocks reset before each test.
Arm mocks per-test in `beforeEach()`, not in `vi.mock()` factory — factory-time
`mockResolvedValue` gets wiped at test start.

---

## 2. Code Style Guidelines

### General Principles
- **Server Components First**: Use `"use client"` only for interactive components (useState, useEffect, browser hooks)
- **Tailwind CSS**: All styling via Tailwind; use `cn()` from `@/lib/utils` for conditional classes
- **Base UI**: `@base-ui/react` primitives wrapped in `src/components/ui/` (Button, Dialog, etc.)

### Naming Conventions
| Type | Convention | Example |
|------|-----------|---------|
| Directories/Files | `kebab-case` | `test-case-ids.ts`, `src/app/api/v1` |
| Functions/Variables | `camelCase` | `ensureProjectForUser`, `deriveTestCasePrefix` |
| Components | `PascalCase` | `TestsPanel`, `MetricsPanel` |
| Prisma Models | `PascalCase` | `model TestCase` |
| DB Tables | `snake_case` via `@@map` | `@@map("test_cases")` |
| Enums | `SCREAMING_SNAKE_CASE` | `ResultStatus.PASSED` |

### Import Order
1. React/Next.js core (`"use client"`, `next/server`)
2. External deps (`zod`, `lucide-react`, `date-fns`)
3. UI primitives (`@/components/ui/...`)
4. Business logic (`@/lib/...`, `@/auth`)

```typescript
import { useState } from "react";
import { XIcon } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
```

### Types & Validation
- **TypeScript**: Mandatory. Avoid `any`; use `unknown` if needed
- **Zod**: API request/response validation (`import z from "zod"`)
- **Prisma Types**: `import type { Project } from "@prisma/client"`
- **Shared Types**: `src/types/` directory

### Error Handling
```typescript
// Always try-catch async operations
try {
  await db.project.create({ data });
} catch (error) {
  console.error("Error creating project:", { userId, error });
}

// API error responses
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Zod validation errors
if (error instanceof z.ZodError) {
  return NextResponse.json({ error: "Invalid payload.", issues: error.issues }, { status: 400 });
}
```

---

## 3. Project Structure

```
src/
├── proxy.ts                 # Every auth/rate-limit gate: setup, /admin, mustChangePassword, login/API rate limits
├── auth.ts                  # NextAuth v5 config — NOT src/lib/auth.ts
├── app/                    # Next.js App Router
│   ├── page.tsx            # Landing/login
│   ├── layout.tsx          # Root layout
│   ├── dashboard/          # Main app routes
│   └── api/v1/             # REST API v1 endpoints
├── components/
│   ├── ui/                 # Base UI wrappers (Button, Dialog, etc.)
│   ├── auth/               # Login/Register
│   ├── tests-panel.tsx     # Test execution UI
│   └── metrics-panel.tsx   # Dashboard charts
├── lib/
│   ├── db.ts               # Prisma singleton
│   ├── rate-limit.ts       # In-process limiter backing src/proxy.ts
│   ├── login-throttle.ts   # Per-account login-attempt throttle
│   ├── api-auth.ts         # API key + HTTP Basic auth for v1 routes
│   ├── api-pagination.ts   # Shared ?limit= parsing for v1 list routes
│   ├── api-formatters.ts   # v1 response shaping + Prisma include shapes
│   ├── projects.ts         # Project CRUD + provisioning
│   ├── project-membership.ts # Tenant/assignee validation (findNonMemberIds)
│   ├── metrics.ts          # getProjectMetrics() — dashboard + v1 single source
│   ├── flaky-detection.ts  # Flaky test detection
│   ├── failure-category.ts # Failure categorization
│   ├── junit.ts            # JUnit XML parsing
│   ├── csv.ts              # CSV escaping + formula-injection defence
│   ├── test-case-ids.ts    # ID generation (TC-0001)
│   └── utils.ts            # cn() helper
└── types/                  # Shared TypeScript types
prisma/schema.prisma        # DB schema (single source of truth)
```

---

## 4. Key Patterns

### Authentication
- NextAuth v5 beta with Prisma adapter
- `await auth()` in server components to check session
- Config: `src/auth.ts` + `src/app/api/auth/[...nextauth]/route.ts`
- Per-account login-attempt throttling: `src/lib/login-throttle.ts` (credentials login in
  `authorize()`, HTTP Basic auth in `resolveBasicAuth()` / `src/lib/api-auth.ts`)
- `src/proxy.ts` (exported as `auth(handleProxy)`, run on every request) is
  where the setup gate, the `/admin` + `/setup/settings` guard, the
  `mustChangePassword` redirect, and IP/circuit-breaker rate limiting all actually live

### Project Provisioning
- `ensureProjectForUser()` in `src/lib/projects.ts` creates default project on first login
- Test case IDs prefixed by project (e.g., `TC-0001`, `PROJ-001`)

### Test Execution
- Test runs create `TestRun` + `TestResult` records
- JUnit XML ingestion: `src/app/api/v1/runs/route.ts`

### API Conventions
```typescript
// src/app/api/v1/<resource>/route.ts
export async function GET(req: Request) { /* ... */ }
export async function POST(req: Request) { /* ... */ }
```

### UI Components
```typescript
// Button with variants
<Button variant="default" size="default">Save</Button>
// Variants: default, outline, secondary, ghost, destructive, link
// Sizes: default, xs, sm, lg, icon, icon-xs, icon-sm, icon-lg

// Dialog composition
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

// Forms: react-hook-form + @hookform/resolvers + zod
// Notifications: toast() from sonner
```

---

## 5. Commit Guidelines

- Follow [gitmoji](https://gitmoji.dev/) conventions
- Use imperative mood: "Add feature" not "Added feature"
- Branch naming: `feature/<description>` or `fix/<issue-number>`
- Reference issues: `fixes #123`

---

## 6. Important Notes

- **DB Client**: Use singleton `db` from `@/lib/db`; never create new Prisma clients
- **Permissions**: Always verify user belongs to project before mutations
- **Database**: PostgreSQL; prefer `prisma db push` over migrations for rapid dev
- **Accessibility**: Use proper labels, keyboard nav, semantic HTML in components

---

*Update this guide when introducing new frameworks or changing core patterns.*

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
