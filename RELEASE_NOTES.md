# v0.7.0.0

## Added
- Model Context Protocol (MCP) server exposing 24 tools over stdio for managing test cases, suites, bugs, runs, and metrics from any MCP-compatible client.
- Public v1 API coverage for bugs (list, get, create, update, reopen) and defect reports.
- Cursor pagination for the v1 test suites endpoint with `limit`/`cursor` parameters and `next_cursor` in responses.
- Per-account login throttling that counts only failed attempts and clears on successful sign-in.
- GitHub Actions CI workflow running lint, type checks, tests, and the MCP server build on every push and pull request.

## Changed
- The `project_id` parameter is now optional when ingesting a test run through the v1 API and defaults to the project the API key belongs to.
- The v1 bugs API now accepts `external_issue_id` and `issue_tracker_url` in snake_case, matching the rest of the v1 surface (camelCase spellings still work for backward compatibility).
- Project metrics are now computed with database aggregation rather than loading every matching row, and the dashboard and metrics API return identical numbers.
- Percentages returned by the metrics API are now rounded to one decimal place.
- Database indexes were reorganised for the queries the app actually issues, improving dashboard load times and removing a full table scan on every page load.

## Fixed
- JUnit imports now correctly handle self-closing `<failure/>`, `<error/>`, and `<skipped/>` elements.
- JUnit imports no longer silently discard results from nested `<testsuites>` sections produced by merged or aggregated CI reports.
- Malformed or out-of-range `time` attributes in JUnit reports no longer reject entire runs.
- The MCP test-run ingestion tool now works correctly.
- Bug links to external issue trackers supplied through the MCP server are no longer discarded.
- Adding the same test case to a suite twice is now accepted.
- Non-numeric `limit` query parameters now return a validation error instead of a server error.
- Editing a reopened bug no longer silently resets its status.
- Optional bug fields can now be cleared once set.
- Test result updates in manual runs no longer fail silently, and saving notes no longer reverts a result's status.
- Failure categorisation no longer misclassifies failures based on file paths in stack traces and correctly recognises common framework error names.
- Large JUnit uploads no longer stall the server.
- CSV exports no longer produce malformed rows when a project name contains a comma, quote, or newline.

## Security
- Project members with the VIEWER role can no longer create and delete API keys or write to project data through endpoints that now require the appropriate role.
- Test cases from another project can no longer be attached to a test suite.
- User accounts from another tenant can no longer be assigned to a bug.
- Read-only API keys can no longer ingest test runs.
- Changing a password now requires the current password.
- The login rate limiter can no longer be bypassed.
- API keys are no longer accepted after expiry.
- Administrator privileges and forced password resets now take effect immediately without waiting for session expiry.
- The workspace configuration screen now requires authentication.

**Full Changelog**: https://github.com/pdnhan/buggy/compare/v0.6.0.0...v0.7.0.0
