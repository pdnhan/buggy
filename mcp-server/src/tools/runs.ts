import { z } from "zod";
import { apiCall } from "../client.js";

const ListRunsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  source: z.enum(["MANUAL", "AUTOMATED"]).optional(),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "ABORTED"]).optional(),
});

const GetRunInput = z.object({
  id: z.string(),
});

const IngestRunInput = z.object({
  project_id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  results: z.array(
    z.object({
      name: z.string().min(1).max(300),
      suite: z.string().optional(),
      status: z.enum(["passed", "failed", "skipped", "error"]),
      duration_ms: z.number().int().nonnegative().optional(),
      failure_message: z.string().optional(),
      stack_trace: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ).min(1),
});

export const runTools = [
  {
    name: "list_test_runs",
    description: "List test runs for the project with optional filtering",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items per page (default: 20)" },
        cursor: { type: "string", description: "Cursor for pagination" },
        source: { type: "string", enum: ["MANUAL", "AUTOMATED"], description: "Filter by source" },
        status: {
          type: "string",
          enum: ["IN_PROGRESS", "COMPLETED", "ABORTED"],
          description: "Filter by status",
        },
      },
    },
    handler: async (input: unknown) => {
      const { limit, cursor, source, status } = ListRunsInput.parse(input);
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (cursor) params.append("cursor", cursor);
      if (source) params.append("source", source);
      if (status) params.append("status", status);
      return JSON.stringify(await apiCall("/api/v1/runs?" + params, "GET"));
    },
  },
  {
    name: "get_test_run",
    description: "Get a single test run with all its results",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Test run ID" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = GetRunInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/runs/${id}`, "GET"));
    },
  },
  {
    name: "ingest_test_run",
    description:
      "Ingest a test run with results from automated testing. project_id is optional and " +
      "defaults to the project the API key is scoped to — pass it explicitly only if you " +
      "manage multiple projects with one key and need to target a specific one. If provided, " +
      "it must match the API key's project or the request is rejected.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description:
            "Optional. The project ID this run belongs to. Defaults to the API key's own " +
            "project when omitted. If provided, must match the project the API key is " +
            "scoped to.",
        },
        name: { type: "string", description: "Run name/identifier" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Test name" },
              suite: { type: "string", description: "Test suite/module name" },
              status: { type: "string", enum: ["passed", "failed", "skipped", "error"] },
              duration_ms: { type: "number" },
              failure_message: { type: "string" },
              stack_trace: { type: "string" },
              metadata: { type: "object" },
            },
            required: ["name", "status"],
          },
          description: "Array of test results",
        },
      },
      required: ["name", "results"],
    },
    handler: async (input: unknown) => {
      const payload = IngestRunInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/runs", "POST", payload));
    },
  },
];
