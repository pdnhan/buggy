# Monthly Bug Quality Tracking — Deferred Scope

This tracks what's intentionally **not** included in the initial (MVP) implementation of
the Monthly Bug Quality Tracking feature, so it can be picked up in follow-up work.
See the original feature spec for full context; section numbers below refer to it.

## Delivered in the MVP

- Project-scoped bug register: create/edit/delete, `BUG-0001`-style display IDs
- Full classification: severity, priority, bug type, root cause, detection source/phase,
  environment, regression flag
- Automatic leakage classification (UAT/client acceptance/production → leaked),
  production bugs always leaked and non-overridable, admin-only manual override with reason
- Reopen tracking: reopen events with auto-incrementing sequence number, system-calculated
  reopen count, reopen reason required, only reopenable from Fixed/Resolved/Closed
- Root cause required before closing Critical/High/leaked/reopened bugs; closed bugs
  require a prior fixed/resolved date
- Monthly KPI dashboard: all 14 core KPI cards from section 8.1, KPI status badges
  (on target/warning/off target/no target/insufficient data) using the default targets
  from section 8.3, configurable date basis (created/detected/reopened/closed)
- Two charts: Monthly Bug Trend (stacked) and Severity Distribution
- Filtering on the bug register (search, severity, status, leaked, reopened) and CSV
  export that respects active filters
- CSV export of monthly KPIs from the dashboard
- Role-based permissions reusing the existing `ProjectRole` (ADMIN/MEMBER/VIEWER)
- Audit log entries for bug creation, status/severity/priority/root-cause/assignment
  changes, leakage overrides, reopens, and deletion
- `ENABLE_BUG_TRACKING` feature flag wired through admin flags UI, setup wizard, and nav

## Deferred to a follow-up phase

**Configurability (section 22)** — severity levels, priority levels, detection
sources/phases, leaked-phase rules, root-cause categories, reopen reasons, and KPI
targets are all fixed constants (`src/lib/bug-enums.ts`, `src/lib/bug-tracking.ts`)
rather than admin-configurable lookups. An admin UI + DB-backed config would be needed
to let each project override these (section 7.6's "administrator should be able to
configure which phases are considered leaked").

**Fine-grained roles (section 16)** — the spec defines six distinct roles (QA Engineer,
QA Lead, Project Manager, Delivery Manager, Administrator, Management Viewer). This MVP
maps that onto the existing three-tier `ProjectRole` (ADMIN/MEMBER/VIEWER): ADMIN covers
QA Lead + PM + Admin capabilities (including leakage overrides and deletion), MEMBER
covers QA Engineer, VIEWER is read-only. Extending `ProjectRole` (or adding a
project-level permission matrix) is needed for the full permission model.

**Comments & attachments** — the bug detail view doesn't yet have a comment thread or
file attachment upload. `Bug.attachments`/`labels` exist as string-array columns but
have no UI. `ReopenEvent.comment` is a single free-text field rather than a threaded
discussion.

**Audit trail UI** — audit log entries are written (see `src/lib/audit.ts` call sites)
but there's no UI to browse them; today the only reader is the existing user/member
audit flow. A per-bug or per-project audit log viewer is deferred.

**Additional charts (section 9)** — only Monthly Bug Trend and Severity Distribution
are implemented. Leakage Trend, Reopened Bug Trend, Root-Cause Breakdown, Bugs by
Module, Bugs by Detection Phase, and QA Detection Trend are not yet built.

**Cross-project reporting (section 20)** — no agency-level / multi-project dashboard.

**Issue-tracker integration (section 15)** — `externalIssueId` and `issueTrackerUrl`
fields exist on `Bug` for manual linking, but there is no Jira/Azure DevOps/GitHub/
GitLab/Linear sync, CSV import, or webhook-driven status sync.

**Notifications (section 19)** — no in-app/email/Slack/Teams notifications for critical
bugs, production bugs, reopens, aging bugs, or leakage-target breaches.

**Monthly Quality Summary (section 13)** — no structured management summary
(quality assessment, risks, root causes, planned actions, client feedback) entry point.

**PDF export** — CSV/text export is implemented for both the bug register and the
monthly KPI dashboard; a formatted PDF export (like the existing Metrics page's
`jspdf`-based export) is not.

**Delivery metrics (section 21)** — optional monthly delivery metrics (stories
delivered, story points, QA hours, escaped defects per release, etc.) are not modeled.

**Deeper validation (section 18.14)** — chronological ordering across all date fields
(e.g. `firstDetectedDate <= createdAt` edge cases) is only partially enforced. The MVP
enforces the load-bearing rules (reopen eligibility, root cause before closure, closed
requires a fixed date) but does not exhaustively validate every date pair.
