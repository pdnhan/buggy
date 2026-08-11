import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userCanWriteToProject } from "@/lib/projects";
import { parseJUnitXml, toCreateResultData } from "@/lib/junit";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = String(formData.get("projectId") ?? "").trim();
    const runName = String(formData.get("name") ?? "").trim() || `JUnit Upload ${new Date().toISOString()}`;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A JUnit XML file is required." }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds 50MB limit." }, { status: 413 });
    }

    const project = projectId
      ? { id: projectId }
      : await ensureProjectForUser(session.user.id);

    if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await userCanWriteToProject(session.user.id, project.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const xml = await file.text();
    const fileHash = createHash("sha256").update(xml).digest("hex");

    const duplicate = await db.testRun.findFirst({
      where: {
        projectId: project.id,
        fileHash,
      },
      select: { id: true, name: true },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error: "Duplicate run detected.",
          duplicateRunId: duplicate.id,
          duplicateRunName: duplicate.name,
        },
        { status: 409 }
      );
    }

    const parsed = await parseJUnitXml(xml);
    if (!parsed.length) {
      return NextResponse.json({ error: "No test cases found in XML." }, { status: 400 });
    }

    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        createdById: session.user.id,
        name: runName,
        source: "AUTOMATED",
        status: "COMPLETED",
        fileHash,
        completedAt: new Date(),
        results: {
          create: toCreateResultData(parsed),
        },
      },
      include: {
        _count: {
          select: { results: true },
        },
      },
    });

    return NextResponse.json({ runId: run.id, imported: run._count.results }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Unable to parse JUnit XML. Make sure the file is valid." },
      { status: 400 }
    );
  }
}
