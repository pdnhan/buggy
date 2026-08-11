import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveBasicAuth, generateApiKey, hashApiKey } from "@/lib/api-auth";
import { userIsProjectAdmin } from "@/lib/projects";

const createKeySchema = z.object({
  project_id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["READ_WRITE", "READ_ONLY"]).default("READ_WRITE"),
});

export async function GET(request: Request) {
  const user = await resolveBasicAuth(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id") ?? undefined;

  // Only return keys for projects where user is a member
  const memberships = await db.projectMember.findMany({
    where: {
      userId: user.id,
      ...(projectId ? { projectId } : {}),
    },
    select: { projectId: true },
  });

  const projectIds = memberships.map((m) => m.projectId);

  const apiKeys = await db.apiKey.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    api_keys: apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      scope: k.scope,
      key_prefix: k.keyPrefix,
      project_id: k.projectId,
      last_used_at: k.lastUsedAt,
      created_at: k.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const user = await resolveBasicAuth(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });

  let payload: z.infer<typeof createKeySchema>;
  try {
    payload = createKeySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create API key." }, { status: 500 });
  }

  // API keys grant READ_WRITE/READ_ONLY access to the project's data —
  // only admins may mint them. Membership alone would let a VIEWER
  // escalate to full write access.
  if (!(await userIsProjectAdmin(user.id, payload.project_id))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { rawKey, keyPrefix } = generateApiKey();
  const keyHash = await hashApiKey(rawKey);

  const apiKey = await db.apiKey.create({
    data: {
      projectId: payload.project_id,
      userId: user.id,
      name: payload.name,
      keyHash,
      keyPrefix,
      scope: payload.scope,
    },
  });

  return NextResponse.json(
    {
      api_key: {
        id: apiKey.id,
        name: apiKey.name,
        scope: apiKey.scope,
        key_prefix: apiKey.keyPrefix,
        project_id: apiKey.projectId,
        created_at: apiKey.createdAt,
      },
      raw_key: rawKey,
    },
    { status: 201 }
  );
}
