import { z } from "zod";
import { apiCall } from "../client.js";

const ListTestCasesInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  cursor: z.string().optional(),
});

const GetTestCaseInput = z.object({
  id: z.string(),
});

const CreateTestCaseInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  preconditions: z.string().max(10000).optional(),
  expected_result: z.string().max(10000).optional(),
  tags: z.array(z.string()).default([]),
  module_name: z.string().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).default("DRAFT"),
  jira_key: z.string().optional(),
});

const UpdateTestCaseInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  preconditions: z.string().max(10000).optional(),
  expected_result: z.string().max(10000).optional(),
  tags: z.array(z.string()).optional(),
  module_name: z.string().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).optional(),
  jira_key: z.string().optional(),
});

const DeleteTestCaseInput = z.object({
  id: z.string(),
});

const BulkCreateTestCasesInput = z.object({
  test_cases: z.array(CreateTestCaseInput).min(1).max(100),
});

export const testCaseTools = [
  {
    name: "list_test_cases",
    description: "List all test cases for the project with optional filtering and pagination",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items per page (default: 50)" },
        search: { type: "string", description: "Search by title" },
        cursor: { type: "string", description: "Cursor for pagination" },
      },
    },
    handler: async (input: unknown) => {
      const { limit, search, cursor } = ListTestCasesInput.parse(input);
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (search) params.append("search", search);
      if (cursor) params.append("cursor", cursor);
      return JSON.stringify(await apiCall("/api/v1/test-cases?" + params, "GET"));
    },
  },
  {
    name: "get_test_case",
    description: "Get a single test case by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Test case ID" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = GetTestCaseInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-cases/${id}`, "GET"));
    },
  },
  {
    name: "create_test_case",
    description: "Create a new test case",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Test case title" },
        description: { type: "string" },
        preconditions: { type: "string" },
        expected_result: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        module_name: { type: "string" },
        priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        status: { type: "string", enum: ["DRAFT", "ACTIVE", "DEPRECATED"] },
        jira_key: { type: "string" },
      },
      required: ["title"],
    },
    handler: async (input: unknown) => {
      const payload = CreateTestCaseInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/test-cases", "POST", payload));
    },
  },
  {
    name: "update_test_case",
    description: "Update an existing test case",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        preconditions: { type: "string" },
        expected_result: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        module_name: { type: "string" },
        priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        status: { type: "string", enum: ["DRAFT", "ACTIVE", "DEPRECATED"] },
        jira_key: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id, ...rest } = UpdateTestCaseInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-cases/${id}`, "PATCH", rest));
    },
  },
  {
    name: "delete_test_case",
    description: "Delete a test case",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = DeleteTestCaseInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-cases/${id}`, "DELETE"));
    },
  },
  {
    name: "bulk_create_test_cases",
    description: "Create multiple test cases in one request (max 100 per request)",
    inputSchema: {
      type: "object",
      properties: {
        test_cases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              preconditions: { type: "string" },
              expected_result: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              module_name: { type: "string" },
              priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
              status: { type: "string", enum: ["DRAFT", "ACTIVE", "DEPRECATED"] },
              jira_key: { type: "string" },
            },
          },
        },
      },
      required: ["test_cases"],
    },
    handler: async (input: unknown) => {
      const { test_cases } = BulkCreateTestCasesInput.parse(input);
      return JSON.stringify(
        await apiCall("/api/v1/test-cases/bulk", "POST", { test_cases })
      );
    },
  },
];
