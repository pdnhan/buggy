// Shared response formatters + Prisma include shapes for the public v1 REST API
// (src/app/api/v1/**). Keeping these in one place means a field added to an
// API response only needs to change here, not in every route file that
// returns that resource.

import type { Prisma } from "@prisma/client";
import { db } from "./db";

// ─── Test cases ─────────────────────────────────────────────────────────────

export function formatTestCase(tc: {
  id: string;
  displayId: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  expectedResult: string | null;
  tags: string[];
  priority: string;
  status: string;
  jiraKey: string | null;
  createdAt: Date;
  module: { name: string } | null;
}) {
  return {
    id: tc.id,
    display_id: tc.displayId,
    title: tc.title,
    description: tc.description,
    preconditions: tc.preconditions,
    expected_result: tc.expectedResult,
    tags: tc.tags,
    priority: tc.priority,
    status: tc.status,
    jira_key: tc.jiraKey,
    module: tc.module ? { name: tc.module.name } : null,
    created_at: tc.createdAt,
  };
}

// ─── Test suites ────────────────────────────────────────────────────────────

export async function fetchSuiteWithCases(suiteId: string) {
  return db.testSuite.findUnique({
    where: { id: suiteId },
    include: {
      cases: {
        orderBy: { order: "asc" },
        include: {
          testCase: {
            select: { id: true, displayId: true, title: true, priority: true, status: true },
          },
        },
      },
    },
  });
}

export function formatSuiteWithCases(
  suite: NonNullable<Awaited<ReturnType<typeof fetchSuiteWithCases>>>
) {
  return {
    id: suite.id,
    name: suite.name,
    description: suite.description,
    cases: suite.cases.map((c) => ({
      order: c.order,
      test_case: {
        id: c.testCase.id,
        display_id: c.testCase.displayId,
        title: c.testCase.title,
        priority: c.testCase.priority,
        status: c.testCase.status,
      },
    })),
    created_at: suite.createdAt,
  };
}

// ─── Bugs ───────────────────────────────────────────────────────────────────

export const bugInclude = {
  module: true,
  assignedDeveloper: { select: { id: true, name: true, email: true } },
  responsibleQa: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BugInclude;

export function formatBug(bug: Prisma.BugGetPayload<{ include: typeof bugInclude }>) {
  return {
    id: bug.id,
    display_id: bug.displayId,
    title: bug.title,
    description: bug.description,
    external_issue_id: bug.externalIssueId,
    issue_tracker_url: bug.issueTrackerUrl,
    severity: bug.severity,
    priority: bug.priority,
    bug_type: bug.bugType,
    root_cause: bug.rootCause,
    detection_source: bug.detectionSource,
    detection_phase: bug.detectionPhase,
    environment: bug.environment,
    is_regression: bug.isRegression,
    is_leaked: bug.isLeaked,
    sprint: bug.sprint,
    release: bug.release,
    fix_version: bug.fixVersion,
    module: bug.module ? { id: bug.module.id, name: bug.module.name } : null,
    assigned_developer: bug.assignedDeveloper,
    responsible_qa: bug.responsibleQa,
    reporter: bug.reporter,
    client_impact: bug.clientImpact,
    business_impact: bug.businessImpact,
    reproduction_steps: bug.reproductionSteps,
    expected_result: bug.expectedResult,
    actual_result: bug.actualResult,
    notes: bug.notes,
    labels: bug.labels,
    status: bug.status,
    reopen_count: bug.reopenCount,
    first_detected_date: bug.firstDetectedDate,
    first_reopened_date: bug.firstReopenedDate,
    last_reopened_date: bug.lastReopenedDate,
    created_at: bug.createdAt,
    updated_at: bug.updatedAt,
  };
}
