import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveApiKey, bearerToken } from "@/lib/api-auth";
import { fetchSuiteWithCases, formatSuiteWithCases } from "@/lib/api-formatters";

const bodySchema = z.object({
  test_case_ids: z.array(z.string().min(1)).min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  const { id } = await params;
  const suite = await db.testSuite.findFirst({ where: { id, projectId: apiKey.projectId } });
  if (!suite) return NextResponse.json({ error: "Test suite not found." }, { status: 404 });

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to add test cases." }, { status: 500 });
  }

  // CQ-107: dedupe before both the ownership check and the insertion below —
  // same defect and same fix as the internal twin at
  // src/app/api/test-suites/[id]/cases/route.ts. Without it, a legitimate
  // request listing the same id twice makes db.testCase.count() (which
  // counts DISTINCT matching rows) come back smaller than
  // test_case_ids.length and trip a false 422.
  const testCaseIds = [...new Set(payload.test_case_ids)];

  // Cross-project ownership check
  const count = await db.testCase.count({
    where: { id: { in: testCaseIds }, projectId: apiKey.projectId },
  });
  if (count !== testCaseIds.length) {
    return NextResponse.json(
      { error: "One or more test case IDs do not belong to this project." },
      { status: 422 }
    );
  }

  const maxOrder = await db.testSuiteCase.aggregate({
    where: { suiteId: id },
    _max: { order: true },
  });
  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  await db.$transaction([
    db.testSuiteCase.createMany({
      data: testCaseIds.map((tcId, i) => ({
        suiteId: id,
        testCaseId: tcId,
        order: nextOrder + i,
      })),
      skipDuplicates: true,
    }),
    // Clear import badge — case is now "owned" by a suite. projectId is
    // redundant with the ownership `count` check above (which already 404s
    // if any id isn't in apiKey.projectId) but keeps this query safe on its
    // own terms rather than relying on that check never being reordered or
    // removed later — see the internal twin at
    // src/app/api/test-suites/[id]/cases/route.ts (CQ-101).
    db.testCase.updateMany({
      where: { id: { in: testCaseIds }, projectId: apiKey.projectId },
      data: { importBatchId: null },
    }),
  ]);

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  const full = await fetchSuiteWithCases(id);
  return NextResponse.json({ test_suite: formatSuiteWithCases(full!) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing Bearer API key." }, { status: 401 });

  const apiKey = await resolveApiKey(token);
  if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

  if (apiKey.scope === "READ_ONLY") {
    return NextResponse.json({ error: "This API key is read-only." }, { status: 403 });
  }

  const { id } = await params;
  const suite = await db.testSuite.findFirst({ where: { id, projectId: apiKey.projectId } });
  if (!suite) return NextResponse.json({ error: "Test suite not found." }, { status: 404 });

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to remove test cases." }, { status: 500 });
  }

  await db.testSuiteCase.deleteMany({
    where: { suiteId: id, testCaseId: { in: payload.test_case_ids } },
  });

  await db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  const full = await fetchSuiteWithCases(id);
  return NextResponse.json({ test_suite: formatSuiteWithCases(full!) });
}
