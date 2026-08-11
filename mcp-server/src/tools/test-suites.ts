import { z } from "zod";
import { apiCall } from "../client.js";

const ListTestSuitesInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const GetTestSuiteInput = z.object({
  id: z.string(),
});

const CreateTestSuiteInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  test_case_ids: z.array(z.string()).default([]),
});

const UpdateTestSuiteInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const DeleteTestSuiteInput = z.object({
  id: z.string(),
});

const AddTestCasesToSuiteInput = z.object({
  suite_id: z.string(),
  test_case_ids: z.array(z.string()).min(1),
});

const RemoveTestCasesFromSuiteInput = z.object({
  suite_id: z.string(),
  test_case_ids: z.array(z.string()).min(1),
});

export const testSuiteTools = [
  {
    name: "list_test_suites",
    description: "List all test suites for the project",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items per page (default: 50)" },
        cursor: { type: "string", description: "Cursor for pagination" },
      },
    },
    handler: async (input: unknown) => {
      const { limit, cursor } = ListTestSuitesInput.parse(input);
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (cursor) params.append("cursor", cursor);
      return JSON.stringify(await apiCall("/api/v1/test-suites?" + params, "GET"));
    },
  },
  {
    name: "get_test_suite",
    description: "Get a single test suite with all its test cases",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Test suite ID" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = GetTestSuiteInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-suites/${id}`, "GET"));
    },
  },
  {
    name: "create_test_suite",
    description: "Create a new test suite with optional initial test cases",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Suite name" },
        description: { type: "string" },
        test_case_ids: { type: "array", items: { type: "string" }, description: "Initial test case IDs" },
      },
      required: ["name"],
    },
    handler: async (input: unknown) => {
      const payload = CreateTestSuiteInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/test-suites", "POST", payload));
    },
  },
  {
    name: "update_test_suite",
    description: "Update test suite name or description",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id, ...rest } = UpdateTestSuiteInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-suites/${id}`, "PATCH", rest));
    },
  },
  {
    name: "delete_test_suite",
    description: "Delete a test suite",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: unknown) => {
      const { id } = DeleteTestSuiteInput.parse(input);
      return JSON.stringify(await apiCall(`/api/v1/test-suites/${id}`, "DELETE"));
    },
  },
  {
    name: "add_test_cases_to_suite",
    description: "Add one or more test cases to an existing suite",
    inputSchema: {
      type: "object",
      properties: {
        suite_id: { type: "string" },
        test_case_ids: {
          type: "array",
          items: { type: "string" },
          description: "Test case IDs to add",
        },
      },
      required: ["suite_id", "test_case_ids"],
    },
    handler: async (input: unknown) => {
      const { suite_id, test_case_ids } = AddTestCasesToSuiteInput.parse(input);
      return JSON.stringify(
        await apiCall(`/api/v1/test-suites/${suite_id}/cases`, "POST", {
          test_case_ids,
        })
      );
    },
  },
  {
    name: "remove_test_cases_from_suite",
    description: "Remove one or more test cases from a suite",
    inputSchema: {
      type: "object",
      properties: {
        suite_id: { type: "string" },
        test_case_ids: {
          type: "array",
          items: { type: "string" },
          description: "Test case IDs to remove",
        },
      },
      required: ["suite_id", "test_case_ids"],
    },
    handler: async (input: unknown) => {
      const { suite_id, test_case_ids } = RemoveTestCasesFromSuiteInput.parse(input);
      return JSON.stringify(
        await apiCall(`/api/v1/test-suites/${suite_id}/cases`, "DELETE", {
          test_case_ids,
        })
      );
    },
  },
];
