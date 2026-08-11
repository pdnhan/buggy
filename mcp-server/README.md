# Test Management MCP Server

An MCP server for managing test cases, test suites, bug tickets, and defect metrics through Claude Code and other MCP clients.

## Setup

### 1. Create an API Key

Create an API key for the MCP server to use. You need credentials to access the test-management app:

```bash
# Using curl (Basic auth with email:password)
curl -X POST http://localhost:3000/api/v1/api-keys \
  -H "Authorization: Basic $(echo -n 'your-email@example.com:your-password' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "YOUR_PROJECT_ID",
    "name": "MCP Server",
    "scope": "READ_WRITE"
  }'
```

Alternatively, create a key via the UI: project settings → API Keys → Create.

### 2. Set Environment Variables

```bash
export TEST_MGMT_API_URL="http://localhost:3000"  # or your deployed URL
export TEST_MGMT_API_KEY="sk-..."                  # the key from step 1
```

### 3. Build the Server

```bash
cd mcp-server
npm install
npm run build
```

### 4. Register in Claude Code

Add to your `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "test-management": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "TEST_MGMT_API_URL": "http://localhost:3000",
        "TEST_MGMT_API_KEY": "${TEST_MGMT_API_KEY}"
      }
    }
  }
}
```

Then set the env var in your shell:

```bash
export TEST_MGMT_API_KEY="sk-..."
```

Or add to `~/.zshrc` / `~/.bashrc` for persistence.

## Tools

### Test Cases

- `list_test_cases` — List all test cases (paginated, searchable)
- `get_test_case` — Get a single test case by ID
- `create_test_case` — Create a new test case
- `update_test_case` — Update an existing test case
- `delete_test_case` — Delete a test case
- `bulk_create_test_cases` — Create up to 100 test cases at once

### Test Suites

- `list_test_suites` — List all test suites
- `get_test_suite` — Get a suite with all its test cases
- `create_test_suite` — Create a new test suite (optionally add test cases)
- `update_test_suite` — Update suite name/description
- `delete_test_suite` — Delete a suite
- `add_test_cases_to_suite` — Add test cases to an existing suite
- `remove_test_cases_from_suite` — Remove test cases from a suite

### Bug Tickets

- `list_bugs` — List bugs (paginated, filterable by severity/status)
- `get_bug` — Get a single bug by ID
- `create_bug` — Create a new bug ticket (new bugs always start with status OPEN).
  Accepts `external_issue_id` / `issue_tracker_url` (snake_case) to link an external
  tracker (e.g. Jira). The API also accepts camelCase aliases (`externalIssueId` /
  `issueTrackerUrl`) for backward compatibility, but snake_case is the primary form.
- `update_bug` — Update bug details (title, status, root cause, etc.)
- `reopen_bug` — Reopen a fixed/resolved/closed bug with a reason

### Test Runs

- `list_test_runs` — List test runs (MANUAL or AUTOMATED)
- `get_test_run` — Get a run with all its results
- `ingest_test_run` — Ingest an automated test run with results; `project_id` is optional and defaults to the API key's own project

### Metrics & Defect Reports

- `get_project_metrics` — Get test coverage, DDP, escaped defects, defect density
- `log_defect_report` — Log a defect report (requirements covered, bugs found)
- `list_defect_reports` — List recent defect reports

## Example: Create & Link a Test Case to a Bug

```
Create a test case titled "Login with invalid password"
Create a bug for the failed test
Update the bug to assign it to me
List recent bugs with CRITICAL severity
```

The MCP server will handle the API calls, pagination, and response formatting.

## Development

Run the server locally for testing:

```bash
cd mcp-server
npm run build
TEST_MGMT_API_URL=http://localhost:3000 TEST_MGMT_API_KEY=sk-... node dist/index.js
```

Use the MCP inspector to test tool calls:

```bash
npx @modelcontextprotocol/inspector node mcp-server/dist/index.js
```

## API Reference

All routes use Bearer token authentication and support cursor-based pagination:

- `GET /api/v1/test-cases` — List test cases
- `POST /api/v1/test-cases` — Create test case
- `PATCH /api/v1/test-cases/[id]` — Update test case
- `DELETE /api/v1/test-cases/[id]` — Delete test case
- `POST /api/v1/test-cases/bulk` — Bulk create test cases
- `GET /api/v1/test-suites` — List test suites
- `POST /api/v1/test-suites` — Create test suite
- `PATCH /api/v1/test-suites/[id]` — Update test suite
- `DELETE /api/v1/test-suites/[id]` — Delete test suite
- `POST /api/v1/test-suites/[id]/cases` — Add test cases to suite
- `DELETE /api/v1/test-suites/[id]/cases` — Remove test cases from suite
- `GET /api/v1/bugs` — List bugs
- `POST /api/v1/bugs` — Create bug
- `PATCH /api/v1/bugs/[id]` — Update bug
- `POST /api/v1/bugs/[id]/reopen` — Reopen bug
- `GET /api/v1/runs` — List test runs
- `POST /api/v1/runs` — Ingest test run
- `GET /api/v1/metrics` — Get project metrics
- `POST /api/v1/defect-reports` — Log defect report
- `GET /api/v1/defect-reports` — List defect reports

All routes require a valid Bearer API key in the Authorization header.
