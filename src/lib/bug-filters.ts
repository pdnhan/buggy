import {
  BUG_SEVERITY_VALUES,
  BUG_PRIORITY_VALUES,
  BUG_STATUS_VALUES,
  DETECTION_SOURCE_VALUES,
  DETECTION_PHASE_VALUES,
  ROOT_CAUSE_VALUES,
} from "@/lib/bug-enums";
import type { Prisma } from "@prisma/client";

function enumFilter<T extends string>(searchParams: URLSearchParams, param: string, allowed: readonly T[]) {
  const value = searchParams.get(param);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

// Shared by GET /api/bugs (register + filters) and GET /api/bugs/export (CSV),
// so an exported report always reflects the same active filters as the list view.
export function buildBugWhere(searchParams: URLSearchParams, projectId: string): Prisma.BugWhereInput {
  const where: Prisma.BugWhereInput = { projectId };

  const severity = enumFilter(searchParams, "severity", BUG_SEVERITY_VALUES);
  if (severity) where.severity = severity;
  const priority = enumFilter(searchParams, "priority", BUG_PRIORITY_VALUES);
  if (priority) where.priority = priority;
  const status = enumFilter(searchParams, "status", BUG_STATUS_VALUES);
  if (status) where.status = status;
  const detectionSource = enumFilter(searchParams, "detectionSource", DETECTION_SOURCE_VALUES);
  if (detectionSource) where.detectionSource = detectionSource;
  const detectionPhase = enumFilter(searchParams, "detectionPhase", DETECTION_PHASE_VALUES);
  if (detectionPhase) where.detectionPhase = detectionPhase;
  const rootCause = enumFilter(searchParams, "rootCause", ROOT_CAUSE_VALUES);
  if (rootCause) where.rootCause = rootCause;

  const sprint = searchParams.get("sprint")?.trim();
  if (sprint) where.sprint = sprint;
  const release = searchParams.get("release")?.trim();
  if (release) where.release = release;
  const fixVersion = searchParams.get("fixVersion")?.trim();
  if (fixVersion) where.fixVersion = fixVersion;
  const environment = searchParams.get("environment")?.trim();
  if (environment) where.environment = environment;
  const moduleId = searchParams.get("moduleId")?.trim();
  if (moduleId) where.moduleId = moduleId;
  const assignedDeveloperId = searchParams.get("assignedDeveloperId")?.trim();
  if (assignedDeveloperId) where.assignedDeveloperId = assignedDeveloperId;
  const responsibleQaId = searchParams.get("responsibleQaId")?.trim();
  if (responsibleQaId) where.responsibleQaId = responsibleQaId;
  const reporterId = searchParams.get("reporterId")?.trim();
  if (reporterId) where.reporterId = reporterId;

  const leaked = searchParams.get("leaked");
  if (leaked === "true") where.isLeaked = true;
  if (leaked === "false") where.isLeaked = false;

  const reopened = searchParams.get("reopened");
  if (reopened === "true") where.reopenCount = { gt: 0 };
  if (reopened === "false") where.reopenCount = 0;

  const minReopenCount = searchParams.get("minReopenCount");
  if (minReopenCount) where.reopenCount = { gte: Number(minReopenCount) };

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const search = searchParams.get("search")?.trim();
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { displayId: { contains: search, mode: "insensitive" } },
      { externalIssueId: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}
