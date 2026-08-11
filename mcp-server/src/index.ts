import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { testCaseTools } from "./tools/test-cases.js";
import { testSuiteTools } from "./tools/test-suites.js";
import { bugTools } from "./tools/bugs.js";
import { runTools } from "./tools/runs.js";
import { metricsTools } from "./tools/metrics.js";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: unknown) => Promise<string>;
}

const server = new Server(
  {
    name: "test-management",
    version: "1.0.0",
  },
  {
    // Required — without a declared "tools" capability, setRequestHandler
    // for tools/list and tools/call throws at startup: "Server does not
    // support tools".
    capabilities: { tools: {} },
  }
);

// Register all tools
const allTools: ToolDef[] = [...testCaseTools, ...testSuiteTools, ...bugTools, ...runTools, ...metricsTools];

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  })),
}));

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = allTools.find((t) => t.name === name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    // MCP clients omit `arguments` entirely for argument-less tool calls.
    // Every handler's Zod schema calls .parse(input), and z.object({}).parse(undefined)
    // throws — default to {} so no-arg tools (list_*, get_project_metrics) work.
    const result = await tool.handler(args ?? {});
    return {
      content: [
        {
          type: "text" as const,
          text: result,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tool execution failed: ${message}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Test Management MCP server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
