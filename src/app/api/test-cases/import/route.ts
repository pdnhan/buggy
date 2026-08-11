import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ensureProjectForUser, userCanWriteToProject } from "@/lib/projects";
import { reserveTestCaseDisplayIds } from "@/lib/test-case-ids";
import { autoCorrectJiraKey } from "@/lib/jira";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";

// ─── POST /api/test-cases/import ──────────────────────────────────────────────
// Accepts multipart/form-data with:
//   file      – .xlsx or .csv
//   projectId – optional, uses default project when omitted
//
// Expected columns (case-insensitive, order flexible):
//   title (required), description, module, priority, status, tags,
//   preconditions, jira (optional reference key)

function cellValue(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  // Formula cells expose { formula, result }
  if (typeof v === "object" && "result" in v) {
    const res = (v as { result: unknown }).result;
    return res === null || res === undefined ? "" : String(res);
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function parseWorkbook(data: ArrayBuffer, filename: string): Promise<Record<string, unknown>[]> {
  const ext = filename.split(".").pop()?.toLowerCase();
  const workbook = new ExcelJS.Workbook();

  if (ext === "csv") {
    const stream = Readable.from(Buffer.from(data));
    await workbook.csv.read(stream);
  } else if (ext === "xlsx") {
    // exceljs accepts ArrayBuffer at runtime even though typedefs say Buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(data as any);
  } else {
    throw new Error(`Unsupported file type '.${ext}'. Upload a .xlsx or .csv file.`);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers: string[] = [];
  const rows: Record<string, unknown>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber - 1] = cellValue(cell).trim();
      });
      return;
    }
    const rowData: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      if (header) {
        rowData[header] = cellValue(row.getCell(idx + 1));
      }
    });
    rows.push(rowData);
  });

  return rows;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const requestedProjectId = formData.get("projectId") as string | null;
  const mappingRaw = formData.get("mapping") as string | null;

  let mapping: Record<string, string> | null = null;
  if (mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw) as Record<string, string>;
    } catch {
      return NextResponse.json({ error: "Invalid mapping JSON." }, { status: 400 });
    }
  }

  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const project = requestedProjectId
    ? { id: requestedProjectId }
    : await ensureProjectForUser(session.user.id);

  if (!project) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = project.id;
  if (!(await userCanWriteToProject(session.user.id, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await parseWorkbook(await file.arrayBuffer(), file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to parse file." },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "File contains no data rows." }, { status: 400 });
  }

  // Normalise rows using mapping if provided, otherwise auto-detect
  const normalised = rows.map((row) => {
    const out: Record<string, string> = {};
    if (mapping) {
      for (const [targetField, csvHeader] of Object.entries(mapping)) {
        if (csvHeader) {
          out[targetField] = String(row[csvHeader] ?? "").trim();
        }
      }
    } else {
      for (const [k, v] of Object.entries(row)) {
        out[k.toLowerCase().replace(/\s+/g, "")] = String(v ?? "").trim();
      }
    }
    return out;
  });

  const valid = normalised.filter((r) => r.title);
  if (valid.length === 0) {
    return NextResponse.json({ error: "No rows with a 'title' column found." }, { status: 400 });
  }

  const PRIORITY_VALUES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
  type Priority = (typeof PRIORITY_VALUES)[number];
  const STATUS_VALUES = ["DRAFT", "ACTIVE", "DEPRECATED"] as const;
  type Status = (typeof STATUS_VALUES)[number];

  function toPriority(v: string): Priority {
    const u = v.toUpperCase() as Priority;
    return PRIORITY_VALUES.includes(u) ? u : "MEDIUM";
  }
  function toStatus(v: string): Status {
    const u = v.toUpperCase() as Status;
    return STATUS_VALUES.includes(u) ? u : "DRAFT";
  }

  // Module cache to avoid N+1 upserts
  const moduleCache = new Map<string, string>();
  async function getModuleId(
    tx: Prisma.TransactionClient | PrismaClient,
    name: string,
  ): Promise<string | null> {
    if (!name) return null;
    if (moduleCache.has(name)) return moduleCache.get(name)!;
    const mod = await tx.module.upsert({
      where: { projectId_name: { projectId: projectId, name } },
      update: {},
      create: { projectId: projectId, name },
    });
    moduleCache.set(name, mod.id);
    return mod.id;
  }

  // Create the import batch record
  const batch = await db.importBatch.create({
    data: { projectId, filename: file.name },
  });

  const created: string[] = [];
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < valid.length; i++) {
    const row = valid[i];
    try {
      await db.$transaction(async (tx) => {
        const moduleId = await getModuleId(tx, row.module ?? "");
        const tags = (row.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const rawJira = row.jira ?? row.jirakey ?? row.reference;
        const jiraKey = rawJira ? (autoCorrectJiraKey(rawJira).corrected ?? null) : null;

        const [displayId] = await reserveTestCaseDisplayIds(tx, projectId, 1);

        const tc = await tx.testCase.create({
          data: {
            projectId: projectId,
            moduleId,
            importBatchId: batch.id,
            displayId,
            jiraKey,
            title: row.title,
            description: row.description || undefined,
            preconditions: row.preconditions || undefined,
            expectedResult: row.expectedResult || row.expectedresult || row.expected || undefined,
            priority: toPriority(row.priority ?? ""),
            status: toStatus(row.status ?? ""),
            tags,
          },
          select: { id: true },
        });
        created.push(tc.id);
      });
    } catch (err) {
      errors.push({ row: i + 2, error: String(err) });
    }
  }

  // If no cases were created, clean up the empty batch
  if (created.length === 0) {
    await db.importBatch.delete({ where: { id: batch.id } }).catch(() => null);
  }

  return NextResponse.json(
    { created: created.length, errors, batchId: batch.id, filename: file.name },
    { status: 201 }
  );
}
