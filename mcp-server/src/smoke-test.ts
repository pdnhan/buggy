// Minimal stdio smoke test: spawns the built server, drives a real
// initialize → tools/list → tools/call exchange, and fails loudly if the
// server crashes at startup or a tool call doesn't produce well-formed JSON.
// This exists because CQ-003 (audit finding) showed tsc + a clean build are
// not sufficient — the server previously threw at startup and every tool
// call sent the wrong HTTP method, and nothing in the type system caught it.
//
// CQ-127: the original version only ever exercised get_project_metrics
// (a GET), which is the one verb the "apiCall(path, method, body) with
// method/args swapped" bug cannot break. It also treated a hung server as
// success (resolve(0) on timeout). Fixed here: at least one POST and one
// PATCH tool call are driven, the HTTP method the stub actually observed is
// asserted per call (not just that a response came back), and a timeout is
// a hard failure with a non-zero exit.
//
// P1 finding (historical): ingest_test_run sent only { name, results } to
// POST /api/v1/runs, but that route required project_id and 400s on every
// call — the tool never worked. A response-shape-only check (as above)
// would not have caught this, because the stub always returns 200
// regardless of what it received. So the ingest_test_run cases below
// additionally capture the raw request body the stub observed and assert
// it contains the fields the real route's payloadSchema requires.
//
// project_id is now optional on the route (it defaults to the API key's
// own project when absent) and on the tool's input schema, so the old
// "project_id is always required" assertion is no longer correct. It is
// replaced by two cases that together give at least as strong a guard
// against a tool that fails on every invocation:
//   - one call WITHOUT project_id: must still succeed, and the body the
//     stub observed must carry `name` and `results` (dropping either would
//     mean the tool is broken regardless of project_id).
//   - one call WITH project_id: must succeed, and the body must forward
//     project_id verbatim (proves the optional field, when supplied, still
//     reaches the request — not silently swallowed by the schema change).
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "index.js");

function startStub(): Promise<{
  close: () => void;
  port: number;
  requests: string[];
  // Keyed by "<METHOD> <url>". Two tool calls can hit the same line (both
  // ingest_test_run cases POST to /api/v1/runs), so each line accumulates
  // every body observed for it, in arrival order — callers disambiguate by
  // content (see `matchBody` below), not by array position, since the MCP
  // server does not guarantee call ordering on the wire.
  bodies: Record<string, string[]>;
}> {
  const requests: string[] = [];
  const bodies: Record<string, string[]> = {};
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const line = `${req.method} ${req.url}`;
      requests.push(line);
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (chunks.length > 0) {
          (bodies[line] ??= []).push(Buffer.concat(chunks).toString("utf8"));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "b1", project_id: "p1", coverage: 0 }));
      });
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ close: () => server.close(), port, requests, bodies });
    });
  });
}

// Each entry pairs an MCP tools/call request with the HTTP method the stub
// server MUST observe for it. This is what actually catches an apiCall
// argument swap: a GET-only assertion cannot, because GET is the one verb
// that bug leaves unaffected.
//
// `expectedBodyFields`, where present, additionally asserts the request body
// the stub received actually contains every listed top-level field — not
// just that a 200 came back. This is what would have caught ingest_test_run
// sending { name, results } and silently getting a 400 from the real API
// every time: the stub returns 200 no matter what it's sent, so only
// inspecting the body (not just the response) proves the client built the
// request the real route requires.
const toolCalls: {
  id: number;
  name: string;
  args: Record<string, unknown>;
  expectedMethod: string;
  expectedPath: string;
  expectedBodyFields?: string[];
  // Only needed when more than one call in this list hits the same
  // "<METHOD> <path>" line (both ingest_test_run cases POST to
  // /api/v1/runs): picks this call's body out of the set the stub observed
  // for that line, by content rather than arrival order.
  matchBody?: (parsed: Record<string, unknown>) => boolean;
}[] = [
  {
    id: 3,
    name: "get_project_metrics",
    args: {},
    expectedMethod: "GET",
    expectedPath: "/api/v1/metrics",
  },
  {
    id: 4,
    name: "create_bug",
    args: {
      title: "Smoke test bug",
      severity: "LOW",
      detectionPhase: "QA",
    },
    expectedMethod: "POST",
    expectedPath: "/api/v1/bugs",
  },
  {
    id: 5,
    name: "update_bug",
    args: {
      id: "b1",
      status: "OPEN",
    },
    expectedMethod: "PATCH",
    expectedPath: "/api/v1/bugs/b1",
  },
  {
    id: 6,
    name: "ingest_test_run",
    args: {
      name: "Smoke test run (no project_id)",
      results: [{ name: "smoke test case", status: "passed" }],
    },
    expectedMethod: "POST",
    expectedPath: "/api/v1/runs",
    // project_id is intentionally omitted here — the route now defaults it
    // to the API key's project. `name` and `results` are still required by
    // payloadSchema in src/app/api/v1/runs/route.ts, so a body missing
    // either is the exact shape that gets a 400 on every real invocation.
    expectedBodyFields: ["name", "results"],
    matchBody: (parsed) => parsed.name === "Smoke test run (no project_id)",
  },
  {
    id: 7,
    name: "ingest_test_run",
    args: {
      project_id: "p1",
      name: "Smoke test run (with project_id)",
      results: [{ name: "smoke test case", status: "passed" }],
    },
    expectedMethod: "POST",
    expectedPath: "/api/v1/runs",
    // project_id is optional but, when supplied, must still reach the
    // request body unchanged — proves the schema change didn't silently
    // drop it.
    expectedBodyFields: ["project_id", "name", "results"],
    matchBody: (parsed) => parsed.name === "Smoke test run (with project_id)",
  },
];

async function main() {
  const stub = await startStub();

  const child = spawn("node", [SERVER_ENTRY], {
    env: {
      ...process.env,
      TEST_MGMT_API_URL: `http://localhost:${stub.port}`,
      TEST_MGMT_API_KEY: "smoke-test-key",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ...toolCalls.map((call) => ({
      jsonrpc: "2.0",
      id: call.id,
      method: "tools/call",
      params: { name: call.name, arguments: call.args },
    })),
  ];
  for (const req of requests) {
    child.stdin.write(JSON.stringify(req) + "\n");
  }
  child.stdin.end();

  let timedOut = false;
  const exitCode: number = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
    setTimeout(() => {
      timedOut = true;
      child.kill();
      resolve(1);
    }, 3000);
  });

  stub.close();

  const failures: string[] = [];

  if (timedOut) {
    failures.push(
      "server did not exit within the 3s timeout (hung) — a hang is a failure, not a pass"
    );
  }

  if (stderr.includes("Error") || stderr.includes("Fatal")) {
    failures.push(`server logged an error on startup:\n${stderr}`);
  }

  const lines = stdout.trim().split("\n").filter(Boolean);
  let responses: unknown[] = [];
  try {
    responses = lines.map((l) => JSON.parse(l));
  } catch (error) {
    failures.push(
      `server stdout was not line-delimited JSON: ${error instanceof Error ? error.message : String(error)}\nstdout was:\n${stdout}`
    );
  }

  type JsonRpcResponse = { id?: number; result?: { tools?: unknown[]; content?: { text?: string }[] } };
  const byId = (id: number) => (responses as JsonRpcResponse[]).find((r) => r?.id === id);

  const toolsListResponse = byId(2);
  if (!toolsListResponse?.result?.tools || toolsListResponse.result.tools.length !== 24) {
    failures.push(
      `expected tools/list to return 24 tools, got ${toolsListResponse?.result?.tools?.length ?? "none"} (response: ${JSON.stringify(toolsListResponse)})`
    );
  }

  // For each tool call: the response must carry content, AND the stub must
  // have observed the exact "<METHOD> <path>" line for it. Checking status
  // alone (a response came back at all) is not enough — a GET sent instead
  // of a POST still gets a 200 from this stub and still produces well-formed
  // JSON content, which is exactly how the original swapped-argument bug
  // slipped past a status-only check.
  for (const call of toolCalls) {
    const response = byId(call.id);
    if (!response?.result?.content?.[0]?.text) {
      failures.push(
        `expected tools/call "${call.name}" (id ${call.id}) to return content, got: ${JSON.stringify(response)}`
      );
    }

    const expectedLine = `${call.expectedMethod} ${call.expectedPath}`;
    if (!stub.requests.includes(expectedLine)) {
      failures.push(
        `expected the stub API to receive "${expectedLine}" for tool "${call.name}", got: ${JSON.stringify(stub.requests)}`
      );
    } else if (call.expectedBodyFields) {
      const rawBodies = stub.bodies[expectedLine] ?? [];
      const parsedBodies: { raw: string; parsed: Record<string, unknown> | undefined }[] =
        rawBodies.map((raw) => {
          try {
            return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
          } catch {
            return { raw, parsed: undefined };
          }
        });

      // When multiple calls share a line (both ingest_test_run cases POST
      // to /api/v1/runs), pick this call's body by content via matchBody —
      // the MCP server does not guarantee wire ordering, so a positional
      // pick would be flaky.
      const candidate = call.matchBody
        ? parsedBodies.find((b) => b.parsed && call.matchBody!(b.parsed))
        : parsedBodies[0];

      if (!candidate) {
        failures.push(
          `expected the stub API to receive a request body for "${expectedLine}" (tool "${call.name}") matching this call, but got: ${JSON.stringify(rawBodies)}`
        );
      } else if (!candidate.parsed) {
        failures.push(
          `expected the stub API's body for "${expectedLine}" (tool "${call.name}") to be JSON, got: ${candidate.raw}`
        );
      } else {
        const parsedBody = candidate.parsed;
        const missing = call.expectedBodyFields.filter((field) => !(field in parsedBody));
        if (missing.length > 0) {
          failures.push(
            `expected the request body for "${expectedLine}" (tool "${call.name}") to contain field(s) ${JSON.stringify(missing)} — the real API requires them and would 400 without them. Body was: ${candidate.raw}`
          );
        }
        // For every expected field the call actually supplied as an
        // argument, assert it was forwarded verbatim — not just present.
        // This is what proves project_id (optional, easy to accidentally
        // drop while making it optional) still reaches the request
        // unchanged when the caller does supply it.
        for (const field of call.expectedBodyFields) {
          if (!(field in call.args)) continue;
          const expected = JSON.stringify(call.args[field]);
          const actual = JSON.stringify(parsedBody[field]);
          if (actual !== expected) {
            failures.push(
              `expected field "${field}" in the request body for "${expectedLine}" (tool "${call.name}") to be forwarded verbatim as ${expected}, got ${actual}. Body was: ${candidate.raw}`
            );
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error("SMOKE TEST FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  console.log(
    `Smoke test passed (server exited with code ${exitCode}, 24 tools listed, ${toolCalls.length} tool calls verified by HTTP method: ${toolCalls
      .map((c) => `${c.name}=${c.expectedMethod}`)
      .join(", ")}).`
  );
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
