// Central source of truth for Bug-tracking enum values + display labels.
// Consumed by both the Zod validation schemas (API routes) and the UI
// dropdowns, so the two never drift out of sync.

export const BUG_SEVERITIES = [
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
] as const;

export const BUG_PRIORITIES = [
  { value: "HIGHEST", label: "Highest" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "LOWEST", label: "Lowest" },
] as const;

export const BUG_STATUSES = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "READY_FOR_QA", label: "Ready for QA" },
  { value: "IN_QA", label: "In QA" },
  { value: "FIXED", label: "Fixed" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "REOPENED", label: "Reopened" },
  { value: "REJECTED", label: "Rejected" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "CANNOT_REPRODUCE", label: "Cannot Reproduce" },
  { value: "DEFERRED", label: "Deferred" },
] as const;

export const DETECTION_SOURCES = [
  { value: "QA", label: "QA" },
  { value: "DEVELOPER", label: "Developer" },
  { value: "INTERNAL_STAKEHOLDER", label: "Internal stakeholder" },
  { value: "CLIENT", label: "Client" },
  { value: "UAT_TESTER", label: "UAT tester" },
  { value: "END_USER", label: "End user" },
  { value: "MONITORING_SYSTEM", label: "Monitoring system" },
  { value: "SUPPORT_TEAM", label: "Support team" },
  { value: "PRODUCTION_OPERATIONS", label: "Production operations" },
  { value: "OTHER", label: "Other" },
] as const;

export const DETECTION_PHASES = [
  { value: "DEVELOPMENT", label: "Development" },
  { value: "CODE_REVIEW", label: "Code review" },
  { value: "UNIT_TESTING", label: "Unit testing" },
  { value: "INTEGRATION_TESTING", label: "Integration testing" },
  { value: "QA", label: "QA" },
  { value: "REGRESSION_TESTING", label: "Regression testing" },
  { value: "STAGING", label: "Staging" },
  { value: "UAT", label: "UAT" },
  { value: "CLIENT_ACCEPTANCE", label: "Client acceptance" },
  { value: "PRODUCTION", label: "Production" },
] as const;

export const ROOT_CAUSES = [
  { value: "REQUIREMENT_MISUNDERSTANDING", label: "Requirement misunderstanding" },
  { value: "MISSING_REQUIREMENT", label: "Missing requirement" },
  { value: "INCORRECT_BUSINESS_LOGIC", label: "Incorrect business logic" },
  { value: "VALIDATION_ISSUE", label: "Validation issue" },
  { value: "UI_IMPLEMENTATION_ISSUE", label: "UI implementation issue" },
  { value: "API_ISSUE", label: "API issue" },
  { value: "INTEGRATION_ISSUE", label: "Integration issue" },
  { value: "DATABASE_ISSUE", label: "Database issue" },
  { value: "PERFORMANCE_ISSUE", label: "Performance issue" },
  { value: "SECURITY_ISSUE", label: "Security issue" },
  { value: "ENVIRONMENT_ISSUE", label: "Environment issue" },
  { value: "DEPLOYMENT_ISSUE", label: "Deployment issue" },
  { value: "CONFIGURATION_ISSUE", label: "Configuration issue" },
  { value: "REGRESSION", label: "Regression" },
  { value: "MISSING_TEST_CASE", label: "Missing test case" },
  { value: "INCOMPLETE_TEST_COVERAGE", label: "Incomplete test coverage" },
  { value: "HUMAN_ERROR", label: "Human error" },
  { value: "THIRD_PARTY_DEPENDENCY", label: "Third-party dependency" },
  { value: "DATA_ISSUE", label: "Data issue" },
  { value: "OTHER", label: "Other" },
] as const;

export const REOPEN_REASONS = [
  { value: "FIX_DID_NOT_RESOLVE", label: "Fix did not resolve the issue" },
  { value: "ISSUE_STILL_REPRODUCIBLE", label: "Issue still reproducible" },
  { value: "PARTIAL_FIX", label: "Partial fix" },
  { value: "ACCEPTANCE_CRITERIA_NOT_MET", label: "Acceptance criteria not met" },
  { value: "REGRESSION_CAUSED_BY_FIX", label: "Regression caused by fix" },
  { value: "DIFFERENT_SCENARIO_STILL_AFFECTED", label: "Different scenario still affected" },
  { value: "INCORRECT_DEPLOYMENT", label: "Incorrect deployment" },
  { value: "FIX_MISSING_FROM_RELEASE", label: "Fix missing from target release" },
  { value: "ENVIRONMENT_MISMATCH", label: "Environment mismatch" },
  { value: "INSUFFICIENT_TEST_EVIDENCE", label: "Insufficient test evidence" },
  { value: "OTHER", label: "Other" },
] as const;

function values<T extends { value: string }>(list: readonly T[]) {
  return list.map((item) => item.value) as [T["value"], ...T["value"][]];
}

export const BUG_SEVERITY_VALUES = values(BUG_SEVERITIES);
export const BUG_PRIORITY_VALUES = values(BUG_PRIORITIES);
export const BUG_STATUS_VALUES = values(BUG_STATUSES);
export const DETECTION_SOURCE_VALUES = values(DETECTION_SOURCES);
export const DETECTION_PHASE_VALUES = values(DETECTION_PHASES);
export const ROOT_CAUSE_VALUES = values(ROOT_CAUSES);
export const REOPEN_REASON_VALUES = values(REOPEN_REASONS);

function labelFor(list: readonly { value: string; label: string }[], value: string) {
  return list.find((item) => item.value === value)?.label ?? value;
}

export const bugSeverityLabel = (value: string) => labelFor(BUG_SEVERITIES, value);
export const bugPriorityLabel = (value: string) => labelFor(BUG_PRIORITIES, value);
export const bugStatusLabel = (value: string) => labelFor(BUG_STATUSES, value);
export const detectionSourceLabel = (value: string) => labelFor(DETECTION_SOURCES, value);
export const detectionPhaseLabel = (value: string) => labelFor(DETECTION_PHASES, value);
export const rootCauseLabel = (value: string) => labelFor(ROOT_CAUSES, value);
export const reopenReasonLabel = (value: string) => labelFor(REOPEN_REASONS, value);
