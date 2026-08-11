import { z } from "zod";
import { apiCall } from "../client.js";

const GetMetricsInput = z.object({});

const LogDefectReportInput = z.object({
  requirementsCovered: z.number().int().min(0),
  totalRequirements: z.number().int().min(0),
  testingBugsFound: z.number().int().min(0),
  productionBugsFound: z.number().int().min(0),
  notes: z.string().optional(),
});

const ListDefectReportsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const metricsTools = [
  {
    name: "get_project_metrics",
    description:
      "Get current project metrics including test coverage, DDP, escaped defects, and defect density",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (input: unknown) => {
      GetMetricsInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/metrics", "GET"));
    },
  },
  {
    name: "log_defect_report",
    description:
      "Log a new defect report with testing/production bug counts and requirements coverage",
    inputSchema: {
      type: "object",
      properties: {
        requirementsCovered: {
          type: "number",
          description: "Number of requirements covered by testing",
        },
        totalRequirements: { type: "number", description: "Total number of requirements" },
        testingBugsFound: { type: "number", description: "Bugs found during testing" },
        productionBugsFound: { type: "number", description: "Bugs found in production" },
        notes: { type: "string", description: "Additional notes" },
      },
      required: ["requirementsCovered", "totalRequirements", "testingBugsFound", "productionBugsFound"],
    },
    handler: async (input: unknown) => {
      const payload = LogDefectReportInput.parse(input);
      return JSON.stringify(await apiCall("/api/v1/defect-reports", "POST", payload));
    },
  },
  {
    name: "list_defect_reports",
    description: "List recent defect reports for the project",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max reports to return (default: 20, max: 100)",
        },
      },
    },
    handler: async (input: unknown) => {
      const { limit } = ListDefectReportsInput.parse(input);
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      return JSON.stringify(await apiCall("/api/v1/defect-reports?" + params, "GET"));
    },
  },
];
