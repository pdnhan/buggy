# Test Management MCP Server — Setup & Usage

Built an MCP server for managing test cases, test suites, bug tickets, and defect metrics.

## What's New

### Part 1: v1 API Routes (Server Side)

Filled the gap between the existing v1 test-case/suite/run routes and the internal-only bug/metrics routes. All new routes use Bearer API key auth + cursor pagination, matching existing v1 patterns.

**New files:**
- `src/lib/metrics.ts` — `getProjectMetrics(projectId)` extracted from internal route, now reused by both internal `/api/metrics` and new v1 `/api/v1/metrics`.
- `src/app/api/v1/bugs/route.ts` — `GET` (list, filterable by severity/status), `POST` (create bug, phase-based auto-leakage).
- `src/app/api/v1/bugs/[id]/route.ts` — `GET` (single bug), `PATCH` (update bug, reuse `resolveLeakage` + root-cause validation).
- `src/app/api/v1/bugs/[id]/reopen/route.ts` — `POST` (reopen bug with reason).
- `src/app/api/v1/metrics/route.ts` — `GET` (project metrics).
- `src/app/api/v1/defect-reports/route.ts` — `GET` (list reports), `POST` (log new report).

**Note:** API routes **do not** support leakage overrides (phase-based auto-classification only). Bug deletion stays admin-only (not exposed via API). These are intentional security boundaries.

### Part 2: MCP Server Package

Standalone Node.js package at `mcp-server/` — zero coupling to Next.js, runs via stdio.

**Structure:**
```
mcp-server/
  src/
    client.ts               # Fetch wrapper (Bearer auth, error handling)
    index.ts                # MCP server bootstrap + tool registration
    tools/
      test-cases.ts         # 6 tools: list, get, create, update, delete, bulk-create
      test-suites.ts        # 7 tools: list, get, create, update, delete, add-cases, remove-cases
      bugs.ts               # 5 tools: list, get, create, update, reopen
      runs.ts               # 3 tools: list, get, ingest
      metrics.ts            # 3 tools: get-metrics, log-defect-report, list-defect-reports
  package.json, tsconfig.json
  README.md                 # Setup guide + API reference
```

**Total: 24 tools**, one per action. Each tool:
- Zod input schema for validation
- HTTP call to a v1 route via `client.ts`
- JSON response returned as text

**Env vars:**
- `TEST_MGMT_API_URL` — app URL (default: `http://localhost:3000`)
- `TEST_MGMT_API_KEY` — Bearer token (required, no default)

## Quick Start

### 1. Create an API Key

```bash
# Using curl + Basic auth (email:password)
curl -X POST http://localhost:3000/api/v1/api-keys \
  -H "Authorization: Basic $(echo -n 'your-email@example.com:your-password' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "YOUR_PROJECT_ID",
    "name": "MCP Server",
    "scope": "READ_WRITE"
  }'
```

Or create via the UI: project settings → API Keys → Create.

Minting a key requires the **ADMIN** role on the project. The key is a
64-character hex string, shown once at creation and stored only as a
hash — if you lose it, create a new one.

### 2. Set Environment Variable

```bash
export TEST_MGMT_API_KEY="<64-hex-char-key>"
```

Or add to `~/.zshrc` / `~/.bashrc` for persistence.

### 3. Build & Run

```bash
cd mcp-server
npm install
npm run build
```

### 4. Register in Claude Code

Server is already registered in `.mcp.json` — just connect Claude Code:

```bash
# Terminal in this project
npm run dev        # Start the app (http://localhost:3000)

# In Claude Code (or desktop app)
# Tools → test-management MCP server
# You should see 24 tools listed
```

### 5. Register in OpenAI Codex CLI

Codex CLI stores MCP server configuration in `~/.codex/config.toml`. Add a `[mcp_servers.test-management]` section:

```toml
[mcp_servers.test-management]
command = "node"
args = ["/Users/dnpi/Git/buggy/mcp-server/dist/index.js"]
env = { TEST_MGMT_API_URL = "http://localhost:3000", TEST_MGMT_API_KEY = "<64-hex-char-key>" }
```

Replace:
- `/Users/dnpi/Git/buggy/` with your project's **absolute path**
- `<64-hex-char-key>` with your API key (from step 1)

Codex also has a `codex mcp add` subcommand that writes this entry for
you; run `codex mcp add --help` for its current flags rather than
copying them from here.

Then start a Codex session and run `/mcp` — the server should be listed
with its 24 tools.

### 6. Register in ChatGPT Desktop

ChatGPT Desktop shares MCP configuration with Codex CLI. You can configure it either by:

**Option A: Edit `~/.codex/config.toml` directly** (same as Codex CLI above)

**Option B: Use ChatGPT Desktop UI**
1. Open ChatGPT Desktop → Settings → MCP servers
2. Click "Add server"
3. Name: `test-management`
4. Server type: `STDIO`
5. Command: `node /Users/dnpi/Git/buggy/mcp-server/dist/index.js`
6. Environment variables:
   ```
   TEST_MGMT_API_URL=http://localhost:3000
   TEST_MGMT_API_KEY=<64-hex-char-key>
   ```
7. Click Save, then Restart

Again, replace the absolute path and API key as needed. Verify the 24 tools are available by typing `/mcp` in the composer.

**Example interaction (any MCP client):**
```
Me: Create a test case titled "Login with invalid password"
Assistant: Using test-management MCP, creates TC and returns display_id

Me: Create a bug for failed test
Assistant: Posts to /api/v1/bugs, assigns to current API key user

Me: List critical bugs
Assistant: Queries /api/v1/bugs?severity=CRITICAL, paginated
```

**Path note:** The `.mcp.json` file uses a relative path (`mcp-server/dist/index.js`), which works because Claude Code resolves paths from the project root. For Codex CLI and ChatGPT Desktop, use an **absolute path** to the `dist/index.js` file as shown in steps 5 and 6 above.

## Tool Reference

### Test Cases (6 tools)
- `list_test_cases` — paginated, searchable
- `get_test_case` — single case
- `create_test_case` — new case (auto assigns display_id)
- `update_test_case` — patch fields
- `delete_test_case` — remove
- `bulk_create_test_cases` — up to 100 at once

### Test Suites (7 tools)
- `list_test_suites`, `get_test_suite`, `create_test_suite`, `update_test_suite`, `delete_test_suite`
- `add_test_cases_to_suite` — link existing cases
- `remove_test_cases_from_suite` — unlink cases

### Bug Tickets (5 tools)
- `list_bugs` — filterable by severity/status
- `get_bug` — single bug
- `create_bug` — new bug (auto assigns display_id, phase-based leakage; new bugs always start OPEN)
- `update_bug` — patch fields, auto-validates root-cause on closure
- `reopen_bug` — reopen with reason (creates ReopenEvent)

### Test Runs (3 tools)
- `list_test_runs` — by source (MANUAL/AUTOMATED), status
- `get_test_run` — run + results summary
- `ingest_test_run` — post automated test results (project_id optional; defaults to API key's project)

### Metrics (3 tools)
- `get_project_metrics` — test coverage, DDP, escaped defects, defect density, avg time-to-confidence
- `log_defect_report` — new report (requirements covered, bugs found)
- `list_defect_reports` — recent reports

## Implementation Notes

**API Key Scope:**
- `READ_WRITE` — can create/update/delete (except bugs cannot be deleted via API)
- `READ_ONLY` — can list/get only

**Business Rules Enforced:**
- Test case display IDs auto-generated from project prefix + counter
- Bug display IDs auto-generated
- Bugs always created with status OPEN (use `update_bug`/`reopen_bug` to transition)
- Leakage auto-classified by `detectionPhase` (no override via API)
- Root cause required before closing critical/high/leaked/reopened bugs
- Bugs can only be reopened from FIXED/RESOLVED/CLOSED status
- Reopening requires a reason + optional environment/build info
- `create_bug` accepts `external_issue_id` and `issue_tracker_url` in snake_case (camelCase aliases accepted for backward compatibility)

**Cursor Pagination:**
All list endpoints return `next_cursor` and `has_next_page` for standard offset-free pagination.

## Verification

Type check:
```bash
npx tsc --noEmit        # root
cd mcp-server && npm run build  # MCP server
```

Run tests (existing suite, no new tests added yet):
```bash
npx vitest run
```

Test the MCP server manually:
```bash
npm run dev             # Terminal 1: start app
# Terminal 2: export TEST_MGMT_API_KEY="<64-hex-char-key>" && node mcp-server/dist/index.js
# Or use Claude Code's test-management MCP tools
```

## Files Modified/Created

**Modified:**
- `.mcp.json` — registered test-management MCP server
- `src/app/api/metrics/route.ts` — refactored to call `getProjectMetrics()`

**Created:**
- `src/lib/metrics.ts` — extracted metrics computation logic
- `src/app/api/v1/bugs/route.ts`, `[id]/route.ts`, `[id]/reopen/route.ts`
- `src/app/api/v1/metrics/route.ts`
- `src/app/api/v1/defect-reports/route.ts`
- `mcp-server/` — entire standalone package (src/, dist/, package.json, README, tsconfig)

Total impact: **6 new v1 routes + 24 MCP tools + metrics lib extraction**.
