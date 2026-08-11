# Changelog

All notable changes to Buggy are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.7.0.0] - 2026-08-11

### Added
- Model Context Protocol (MCP) server (`mcp-server/`) exposing 24 tools over stdio so an MCP client can manage test cases, suites, bugs, runs, and metrics.
- Public v1 API coverage for bugs (list, get, create, update, reopen) and defect reports — previously only available behind session authentication.
- Cursor pagination for the v1 test suites endpoint (`limit`/`cursor` parameters with `next_cursor` in responses).
- Per-account login throttling that counts only failed attempts and clears on successful sign-in.
- GitHub Actions CI workflow running lint, type checks, tests, and the MCP server build.

### Changed
- `project_id` parameter is now optional when ingesting a test run through the v1 API; it defaults to the project the API key belongs to.
- The v1 bugs API accepts `external_issue_id` and `issue_tracker_url` (snake_case, matching the rest of the v1 surface); the previous camelCase spellings still work.
- Project metrics are now computed with database aggregation rather than loading every matching row, and the dashboard and metrics API return identical numbers.
- Percentages returned by the metrics API are now rounded to one decimal place (previously full floating-point precision).
- Database indexes were reorganised for queries the app actually issues, including an index that removes a full table scan from every dashboard page load.

### Fixed
- JUnit imports recorded failing tests as passing when a report used self-closing `<failure/>`, `<error/>`, or `<skipped/>` elements.
- JUnit imports silently discarded results from nested `<testsuites>` sections, which merged or aggregated CI reports produce.
- A malformed or out-of-range `time` attribute in a JUnit report could reject an entire run.
- The MCP test-run ingestion tool failed on every invocation.
- Bug links to an external issue tracker supplied through the MCP server were silently discarded.
- Adding the same test case to a suite twice was rejected as invalid.
- A non-numeric `limit` query parameter returned a server error instead of a validation error.
- Editing a reopened bug silently reset its status.
- Optional bug fields could not be cleared once set — an assigned developer could never be unassigned.
- Test result updates in a manual run could silently fail, and saving notes could revert a result's status.
- Failure categorisation misclassified failures based on file paths in stack traces, and failed to recognise common framework error names.
- A large JUnit upload could stall the server for several seconds.
- CSV exports could produce malformed rows when a project name contained a comma, quote, or newline.

### Security
- Project members with the VIEWER role could create and delete API keys, and write to project data through several endpoints; these now require the appropriate role.
- Test cases from another project could be attached to a test suite.
- User accounts from another tenant could be assigned to a bug, which exposed that user's name and email address.
- A read-only API key could ingest test runs.
- Changing a password did not require the current password.
- The login rate limiter could be bypassed entirely.
- API keys were accepted for up to a minute after expiry.
- Administrator privileges and forced password resets did not take effect until the user's session expired.
- The workspace configuration screen was reachable without signing in.

---

## [0.6.0.0] - 2026-07-14

### Added
- Monthly Bug Quality Tracking (MVP): project-scoped bug register with severity/priority/root-cause classification, automatic UAT/production leakage detection, and reopen-event tracking with system-calculated reopen counts.
- Monthly Quality Dashboard: 14 core KPI cards with target-status badges, a monthly bug trend chart, a severity distribution chart, and a configurable reporting date basis (creation, detection, reopen, or closure date).
- CSV export for the bug register (filter-aware) and for the monthly KPI dashboard.
- Audit log entries for bug creation, status/severity/root-cause/assignment changes, leakage overrides, reopens, and deletion.
- `ENABLE_BUG_TRACKING` feature flag (off by default) wired through the admin flags UI, the setup wizard, and project navigation — existing projects are unaffected until an admin opts in.

### Changed
- Redesigned dialog UX across the Tests panel with scrollable content areas for long forms, responsive button stacking (vertical on mobile, horizontal on desktop), and border-separated headers and footers.

### Fixed
- Test suite creation now validates that all test case IDs belong to the target project before creating the suite, preventing foreign-key errors and cross-project data contamination.
- Creating a test suite with a duplicate name now returns a 409 Conflict instead of a generic 500 error.

---

## [0.5.3.0] - 2026-04-10

### Added
- Tag filter chips on the Cases tab — filter visible test cases by one or more tags, with a clear-all button and an "Imported only" chip to surface recently imported cases.
- Import batch banners — each import creates a dismissible amber banner listing the batch filename and case count, with actions to undo the entire import, select only the imported cases, or dismiss the badge when satisfied.
- IMPORTED badge and amber left-border on test case table rows — newly imported cases are visually distinct until they are assigned to a suite or the batch is dismissed.
- Tag filter chips on the Manual run tab — same tag-filter experience as the Cases tab while building a manual test run.
- JIRA key auto-correction hint in the create/edit test case form — when a JIRA key is entered that needs normalising (e.g. `ac 3` → `AC-3`), a hint shows the corrected value in amber before saving; invalid keys are flagged in red.
- Three-step import dialog with JIRA review step — Step 3 previews every JIRA key in the CSV, shows which will be auto-corrected and which are invalid, and requires explicit confirmation before the import proceeds.

---

## [0.5.2.1] - 2026-04-10

### Added
- Tag filtering for test suite search — filter test suites by tags.

### Fixed
- Test failures are now correctly categorized with the required arguments.

---

## [0.5.2.0] - 2026-04-08

### Added
- Tag filtering for test suite search — filter test suites by tags.
- Registration CTA on the login page is now gated behind the `openRegistration` feature flag, letting self-hosted instances disable public sign-ups.

### Fixed
- `proxy.ts` setup check is now wrapped in `try/catch` so the server starts even when the database is temporarily unavailable.
- Test failures are now correctly categorized with the required arguments.

---

## [0.5.1.0] - 2026-04-06

### Fixed
- `.xlsx` spreadsheet imports now work correctly by skipping browser-side header detection — the server auto-detects columns by name instead.
- "Save changes" button is now always visible in the Manage cases dialog.
- `middleware.ts` renamed to `proxy.ts` per Next.js 16 convention, eliminating a Next.js 16 build warning.
- Runtime config removed from `proxy.ts` (not allowed in Next.js 16).

---

## [0.5.0.0] - 2026-03-26

### Added
- Admin can now reset any workspace member's password directly from the admin panel — no email flow required for self-hosted instances.
- Project member management: admins can add or remove members from any project without touching the database.
- Navigation links between the workspace view and the admin panel so admins can switch contexts without hunting for URLs.

### Fixed
- Password change now redirects to the dashboard using a hard navigation, so the session refreshes correctly after a forced reset.

---

## [0.4.1.0] - 2026-03-25

### Added
- User management API and admin users panel: list, create, and deactivate workspace members from the admin UI.

### Fixed
- Switch toggles in the admin panel were invisible due to wrong data attribute selectors — now consistently visible.
- "Create one" registration link on the login page is now hidden when self-registration is disabled.
- Change-password UX, landing page rendering, and project auto-provisioning issues (ISSUE-003 through ISSUE-006).
- `isWorkspaceAdmin` flag now correctly survives the NextAuth JWT callback so admin sessions are not lost on refresh.

---

## [0.4.0.0] - 2026-03-24

### Added
- Workspace admin RBAC: a new `isWorkspaceAdmin` role gates access to admin-only routes and UI sections.
- `/setup` wizard: first-run experience that creates the initial workspace admin account.
- `/admin` panel: central admin area for managing users and workspace-level settings.
- REST API v1 endpoints for test cases, test suites, and API key management (read/write).

### Changed
- Redesigned landing page as a multi-section marketing page (15 design improvements applied).
- Dashboard no longer auto-redirects when only one project exists — lets users navigate explicitly.

### Fixed
- `/register` page is now force-dynamic, preventing stale pre-rendered builds from blocking new signups.
- Stale JWT sessions where the user no longer exists in the DB now fail gracefully instead of throwing.
- Geist Sans font wiring — resolved CSS variable self-reference that caused Times New Roman fallback.
- Metric cards use a status dot instead of a colored left border for cleaner visual hierarchy.
- Settings button touch targets normalized; Import JUnit section layout fixed.
- Forgot-password alert replaced with an inline message.
- GitHub repo URL corrected to `pdnhan/buggy`.

---

## [0.3.0.0] - 2026-03-22

### Added
- Enhanced test case import with ID prefix mapping and name normalization.
- Expected result and actual result fields in manual test reports and imports.

### Fixed
- Dockerfile node version updated; debug logging removed.

---

## [0.2.0.0] - 2026-03-20

### Added
- Multi-project support with project-scoped routing — each user can belong to multiple projects.
- Bulk delete for test cases.
- Executive-friendly run reports (printable, clean layout).
- `expectedResult` field on test cases with full import and UI support.
- Flaky test detection across the last 5 runs, with failure categorization.
- Test case CRUD operations with CSV/spreadsheet import support.

### Fixed
- File selection state now resets correctly when the import dialog closes.
- TypeScript errors in `tests-panel.tsx` resolved.
- Docker Compose credentials moved to environment variables (no more hardcoded values).
- Project creation reliability improved.

---

## [0.1.0.0] - 2026-03-18

### Added
- Initial release: Next.js App Router with authentication (email + password via NextAuth v5).
- Prisma + PostgreSQL schema with Projects, TestRuns, TestResults, and TestSuites.
- Dashboard with metrics panel, tests panel, and settings panel.
- API key management with hashed storage.
- Manual test runs via the UI.
- JUnit XML ingestion via `POST /api/v1/runs`.
- Docker Compose stack (app + PostgreSQL + auto-migration).
- Contributing guide and MIT license.
