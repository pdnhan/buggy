import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { reserveTestCaseDisplayIds } from "@/lib/test-case-ids";
import { autoCorrectJiraKey } from "@/lib/jira";

const jiraKeySchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .nullable()
  .transform((val) => {
    if (!val) return null;
    const { corrected } = autoCorrectJiraKey(val);
    return corrected;
  });

const itemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  preconditions: z.string().max(10_000).optional(),
  expected_result: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  module_name: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]).default("DRAFT"),
  jira_key: jiraKeySchema,
});

const bulkSchema = z.object({
  test_cases: z.array(itemSchema).min(1).max(100),
});

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate all items before opening any transaction
  const raw = body as { test_cases?: unknown };
  if (!Array.isArray(raw?.test_cases)) {
    return NextResponse.json({ error: "test_cases must be an array." }, { status: 400 });
  }
  if (raw.test_cases.length === 0) {
    return NextResponse.json({ error: "test_cases array must not be empty." }, { status: 422 });
  }
  if (raw.test_cases.length > 100) {
    return NextResponse.json({ error: "Maximum 100 test cases per request." }, { status: 422 });
  }

  let payload: z.infer<typeof bulkSchema>;
  try {
    payload = bulkSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      const index = typeof firstIssue?.path?.[1] === "number" ? firstIssue.path[1] : 0;
      return NextResponse.json(
        { error: "Validation failed.", index, issues: error.issues },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: "Unable to create test cases." }, { status: 500 });
  }

  const items = payload.test_cases;

  try {
    const created = await db.$transaction(async (tx) => {
      const displayIds = await reserveTestCaseDisplayIds(tx, apiKey.projectId, items.length);

      // Upsert unique module names
      const moduleNames = [...new Set(items.map((i) => i.module_name).filter(Boolean) as string[])];
      const moduleMap = new Map<string, string>();
      for (const name of moduleNames) {
        const mod = await tx.module.upsert({
          where: { projectId_name: { projectId: apiKey.projectId, name } },
          update: {},
          create: { projectId: apiKey.projectId, name },
        });
        moduleMap.set(name, mod.id);
      }

      await tx.testCase.createMany({
        data: items.map((item, i) => ({
          projectId: apiKey.projectId,
          moduleId: item.module_name ? moduleMap.get(item.module_name) : null,
          displayId: displayIds[i],
          jiraKey: item.jira_key ?? null,
          title: item.title,
          description: item.description,
          preconditions: item.preconditions,
          expectedResult: item.expected_result,
          tags: item.tags,
          priority: item.priority,
          status: item.status,
        })),
      });

      return tx.testCase.findMany({
        where: { projectId: apiKey.projectId, displayId: { in: displayIds } },
        orderBy: { displayId: "asc" },
      });
    });

    await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return NextResponse.json(
      {
        test_cases: created.map((tc) => ({
          id: tc.id,
          display_id: tc.displayId,
          title: tc.title,
          priority: tc.priority,
          status: tc.status,
          created_at: tc.createdAt,
        })),
        created: created.length,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Unable to create test cases." }, { status: 500 });
  }
}
