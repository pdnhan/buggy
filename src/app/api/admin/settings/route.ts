import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const SINGLETON_ID = "singleton";

const settingsSchema = z.object({
  enableSessionTesting: z.boolean().optional(),
  enableReleaseTracking: z.boolean().optional(),
  openRegistration: z.boolean().optional(),
  enableBugTracking: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.isWorkspaceAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await db.workspaceSettings.findFirst();
  return NextResponse.json({
    enableSessionTesting: settings?.enableSessionTesting ?? false,
    enableReleaseTracking: settings?.enableReleaseTracking ?? false,
    openRegistration: settings?.openRegistration ?? false,
    enableBugTracking: settings?.enableBugTracking ?? false,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.isWorkspaceAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const settings = await db.workspaceSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json(settings);
}
