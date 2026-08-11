import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userCanWriteToProject } from "@/lib/projects";

// NOTE: intentionally not the shared fetchSuiteWithCases from api-formatters.ts —
// this internal route's frontend consumer (tests-panel.tsx) relies on jiraKey and
// module.name, which the v1-shaped shared helper doesn't select.
async function fetchSuiteWithCases(suiteId: string) {
  return db.testSuite.findUnique({
    where: { id: suiteId },
    include: {
      cases: {
        orderBy: { order: "asc" },
        include: {
          testCase: {
            select: {
              id: true,
              title: true,
              priority: true,
              status: true,
              displayId: true,
              jiraKey: true,
              module: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

// Both callers below are writes (add/remove cases) — VIEWER must not pass
// this check.
async function getSuiteWithAccess(userId: string, suiteId: string) {
  const suite = await db.testSuite.findUnique({ where: { id: suiteId } });
  if (!suite) return null;
  if (!(await userCanWriteToProject(userId, suite.projectId))) return null;
  return suite;
}

// ─── POST /api/test-suites/[id]/cases — add test cases to suite ──────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const suite = await getSuiteWithAccess(session.user.id, id);
  if (!suite) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { testCaseIds: rawTestCaseIds } = z
    .object({ testCaseIds: z.array(z.string()).min(1) })
    .parse(await request.json());

  // CQ-107: dedupe before both the ownership check and the insertion below.
  // A legitimate request that lists the same id twice (e.g. a double-submit
  // or a bulk-select that doesn't dedupe client-side) otherwise makes
  // db.testCase.count() — which counts DISTINCT matching rows — come back
  // smaller than testCaseIds.length and trip a false "foreign id" 422.
  // Deduping (rather than rejecting duplicates in the Zod schema) is
  // idempotent and forgiving of exactly this kind of harmless client
  // repetition, and keeps `nextOrder` from reserving more order slots than
  // there are actual rows to insert.
  const testCaseIds = [...new Set(rawTestCaseIds)];

  // Cross-project ownership check — without this, a caller can link (and via
  // the updateMany below, mutate) test cases belonging to a project they
  // don't have access to.
  const count = await db.testCase.count({
    where: { id: { in: testCaseIds }, projectId: suite.projectId },
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
        addedById: session.user.id,
      })),
      skipDuplicates: true,
    }),
    // Clear import badge — case is now "owned" by a suite
    db.testCase.updateMany({
      where: { id: { in: testCaseIds }, projectId: suite.projectId },
      data: { importBatchId: null },
    }),
  ]);

  const suiteWithCases = await fetchSuiteWithCases(id);
  return NextResponse.json({ success: true, suite: suiteWithCases });
}

// ─── DELETE /api/test-suites/[id]/cases — remove test cases from suite ───────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const suite = await getSuiteWithAccess(session.user.id, id);
  if (!suite) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { testCaseIds } = z
    .object({ testCaseIds: z.array(z.string()).min(1) })
    .parse(await request.json());

  await db.testSuiteCase.deleteMany({
    where: { suiteId: id, testCaseId: { in: testCaseIds } },
  });

  const suiteWithCases = await fetchSuiteWithCases(id);
  return NextResponse.json({ success: true, suite: suiteWithCases });
}
