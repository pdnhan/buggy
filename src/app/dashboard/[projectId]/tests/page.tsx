import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess } from "@/lib/projects";
import { TestsPanel } from "@/components/tests-panel";

export default async function TestsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { projectId } = await params;

  if (!(await userHasProjectAccess(session.user.id, projectId))) {
    notFound();
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, testCasePrefix: true },
  });

  if (!project) notFound();

  const [testCases, activeManualRun, suites, completedRunsRaw, importBatchesRaw] = await Promise.all([
    db.testCase.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        displayId: true,
        title: true,
        priority: true,
        module: { select: { name: true } },
        status: true,
        description: true,
        preconditions: true,
        expectedResult: true,
        tags: true,
        jiraKey: true,
        importBatchId: true,
      },
    }),
    db.testRun.findFirst({
      where: { projectId, source: "MANUAL", status: "IN_PROGRESS" },
      orderBy: { startedAt: "desc" },
      include: {
        results: {
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.testSuite.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        cases: {
          orderBy: { order: "asc" },
          include: {
            testCase: {
              select: {
                id: true,
                displayId: true,
                title: true,
                priority: true,
                status: true,
                jiraKey: true,
                module: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    db.testRun.findMany({
      where: { projectId, source: "MANUAL", status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 20,
      include: { results: { select: { status: true } } },
    }),
    db.importBatch.findMany({
      where: { projectId, dismissed: false },
      orderBy: { importedAt: "desc" },
      include: { _count: { select: { cases: true } } },
    }),
  ]);

  const mappedTestCases = (
    testCases as Array<{
      id: string;
      displayId: string;
      title: string;
      priority: string;
      module: { name: string } | null;
      status: string;
      description: string | null;
      preconditions: string | null;
      expectedResult: string | null;
      tags: string[];
      jiraKey: string | null;
      importBatchId: string | null;
    }>
  ).map((tc) => ({
    id: tc.id,
    displayId: tc.displayId,
    title: tc.title,
    priority: tc.priority,
    module: tc.module?.name ?? null,
    status: tc.status,
    description: tc.description,
    preconditions: tc.preconditions,
    expectedResult: tc.expectedResult,
    tags: tc.tags,
    jiraKey: tc.jiraKey,
    importBatchId: tc.importBatchId,
  }));

  const mappedRun = activeManualRun
    ? {
        id: activeManualRun.id,
        name: activeManualRun.name,
        status: activeManualRun.status,
        results: activeManualRun.results as Array<{
          id: string;
          name: string;
          status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR" | "BLOCKED";
        }>,
      }
    : null;

  const completedRuns = completedRunsRaw.map((run) => ({
    id: run.id,
    name: run.name,
    completedAt: run.completedAt?.toISOString() ?? null,
    startedAt: run.startedAt.toISOString(),
    passed: run.results.filter((r) => r.status === "PASSED").length,
    failed: run.results.filter((r) => r.status === "FAILED").length,
    skipped: run.results.filter((r) => r.status === "SKIPPED" || r.status === "BLOCKED").length,
    total: run.results.length,
  }));

  const importBatches = importBatchesRaw.map((b) => ({
    id: b.id,
    filename: b.filename,
    importedAt: b.importedAt.toISOString(),
    caseCount: b._count.cases,
  }));

  return (
    <TestsPanel
      projectId={project.id}
      testCasePrefix={project.testCasePrefix}
      testCases={mappedTestCases}
      activeManualRun={mappedRun}
      suites={suites}
      completedRuns={completedRuns}
      importBatches={importBatches}
    />
  );
}
