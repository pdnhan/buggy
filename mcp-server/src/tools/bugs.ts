import { z } from "zod";
import { apiCall } from "../client.js";

const ListBugsInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  severity: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

const GetBugInput = z.object({
  id: z.string(),
});

const CreateBugInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  external_issue_id: z.string().optional(),
  issue_tracker_url: z.string().optional(),
  module_name: z.string().optional(),
  sprint: z.string().optional(),
  release: z.string().optional(),
  fixVersion: z.string().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  priority: z.enum(["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"]).default("MEDIUM"),
  bugType: z.string().optional(),
  rootCause: z.string().optional(),
  detectionSource: z.string().default("QA"),
  detectionPhase: z.enum([
    "DEVELOPMENT",
    "CODE_REVIEW",
    "UNIT_TESTING",
    "INTEGRATION_TESTING",
    "QA",
    "REGRESSION_TESTING",
    "STAGING",
    "UAT",
    "CLIENT_ACCEPTANCE",
    "PRODUCTION",
  ]),
  environment: z.string().optional(),
  isRegression: z.boolean().default(false),
  assignedDeveloperId: z.string().optional(),
  responsibleQaId: z.string().optional(),
  clientImpact: z.string().optional(),
  businessImpact: z.string().optional(),
  reproductionSteps: z.string().optional(),
  expectedResult: z.string().optional(),
  actualResult: z.string().optional(),
  notes: z.string().optional(),
  labels: z.array(z.string()).default([]),
  firstDetectedDate: z.string().optional(),
});

const UpdateBugInput = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  status: z.string().optional(),
  rootCause: z.string().optional(),
  priority: z.enum(["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"]).optional(),
});

const ReopenBugInput = z.object({
  id: z.string(),
  reason: z.string(),
  comment: z.string().optional(),
  environment: z.string().optional(),
});

export const bugTools = [
  {
    name: "list_bugs",
    description: "List all bugs for the project with optional filtering and pagination",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items per page (default: 50)" },
        cursor: { type: "string", description: "Cursor for pagination" },
        severity: { type: "string", description: "Filter by severity (CRITICAL, HIGH, MEDIUM, LOW)" },
        priority: {
          type: "string",
          description: "Filter by priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)",
        },
        status: { type: "string", description: "Filter by status" },
        search: { type: "string", description: "Search by title or description" },
      },
    },
    handler: async (input: unknown) => {
      const { limit, cursor, severity, priority, status, search } = ListBugsInput.parse(input);
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (cursor) params.append("cursor", cursor);
      if (severity) params.append("severity", severity);
      if (priority) params.append("priority", priority);
      if (status) params.append("status", status);
      if (search) params.append("search", search);
      return JSON.stringify(await apiCall("/api/v1/bugs?" + params, "GET"));
    },
  },
  {
    name: "get_bug",
    description: "Get a single bug by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Bug ID" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = GetBugInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/bugs/${id}`, "GET"));
    },
  },
  {
    name: "create_bug",
    // status is deliberately NOT settable here: the API always creates new
    // bugs as OPEN (src/app/api/v1/bugs/route.ts has no status field in its
    // create schema) and the domain model in src/lib/bug-tracking.ts routes
    // every status transition through PATCH /api/v1/bugs/[id] (update_bug) or
    // POST /api/v1/bugs/[id]/reopen (reopen_bug), which enforce the lifecycle
    // rules (e.g. reopen requires the bug to already be FIXED/RESOLVED/CLOSED
    // and records a ReopenEvent). Use update_bug or reopen_bug after creation
    // to change status.
    description:
      "Create a new bug ticket. New bugs always start with status OPEN — use update_bug or " +
      "reopen_bug afterwards to change status.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        detectionPhase: { type: "string" },
        rootCause: { type: "string" },
        priority: { type: "string" },
        environment: { type: "string" },
        isRegression: { type: "boolean" },
      },
      required: ["title", "severity", "detectionPhase"],
    },
    handler: async (input: unknown) => {
      const payload = CreateBugInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/bugs", "POST", payload));
    },
  },
  {
    name: "update_bug",
    description: "Update an existing bug",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        status: { type: "string" },
        rootCause: { type: "string" },
        priority: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id, ...rest } = UpdateBugInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/bugs/${id}`, "PATCH", rest));
    },
  },
  {
    name: "reopen_bug",
    description: "Reopen a fixed/resolved/closed bug",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        reason: { type: "string", description: "Reason for reopening" },
        comment: { type: "string" },
        environment: { type: "string" },
      },
      required: ["id", "reason"],
    },
    handler: async (input: unknown) => {
      const { id, ...rest } = ReopenBugInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/bugs/${id}/reopen`, "POST", rest));
    },
  },
];
