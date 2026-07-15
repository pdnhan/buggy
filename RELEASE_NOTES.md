# v0.6.0.0

## Added
- Monthly Bug Quality Tracking (MVP): project-scoped bug register with severity/priority/root-cause classification, automatic UAT/production leakage detection, and reopen-event tracking with system-calculated reopen counts.
- Monthly Quality Dashboard: 14 core KPI cards with target-status badges, a monthly bug trend chart, a severity distribution chart, and a configurable reporting date basis (creation, detection, reopen, or closure date).
- CSV export for the bug register (filter-aware) and for the monthly KPI dashboard.
- Audit log entries for bug creation, status/severity/root-cause/assignment changes, leakage overrides, reopens, and deletion.
- `ENABLE_BUG_TRACKING` feature flag (off by default) wired through the admin flags UI, the setup wizard, and project navigation.

## Changed
- Redesigned dialog UX across the Tests panel with scrollable content areas, responsive button stacking, and border-separated headers/footers.

## Fixed
- Test suite creation now validates that all test case IDs belong to the target project before creating the suite.
- Creating a test suite with a duplicate name now returns a 409 Conflict instead of a generic 500 error.

**Full Changelog**: https://github.com/pdnhan/buggy/compare/v0.5.2.1...v0.6.0.0
