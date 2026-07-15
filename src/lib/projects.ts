import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { deriveTestCasePrefix, sanitizeTestCasePrefix } from "./test-case-ids";

function defaultProjectName(userName: string | null | undefined) {
  if (!userName?.trim()) return "My Project";
  return `${userName.split(" ")[0]}'s Project`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function ensureProjectForUser(userId: string) {
  try {
    // First, check if user already has a project membership
    const existingMembership = await db.projectMember.findFirst({
      where: { userId },
      include: { project: true },
      orderBy: { createdAt: "asc" },
    });

    if (existingMembership) {
      return existingMembership.project;
    }

    // Verify user exists before proceeding
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    // If user doesn't exist, the session is stale — return null so the caller
    // can redirect to login rather than crashing the Server Component.
    if (!user) {
      return null;
    }

    // Create default project for user
    const name = defaultProjectName(user.name);
    const slugBase = slugify(name) || "project";
    const prefix = deriveTestCasePrefix(name);

    return await db.project.create({
      data: {
        name,
        slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
        testCasePrefix: prefix,
        members: {
          create: {
            userId: user.id, // Use verified user ID
            role: "ADMIN",
          },
        },
      },
    });
  } catch (error) {
    // Log error details for debugging
    console.error("Error in ensureProjectForUser:", {
      userId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Re-throw to let calling code handle it appropriately
    throw error;
  }
}

export async function getUserProjects(userId: string) {
  const memberships = await db.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          _count: { select: { members: true, testCases: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.project, role: m.role }));
}

export async function createProject(
  userId: string,
  data: { name: string; description?: string; initials?: string },
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;
  const name = data.name.trim();
  const slugBase = slugify(name) || "project";
  const prefix = data.initials
    ? sanitizeTestCasePrefix(data.initials)
    : deriveTestCasePrefix(name);

  return client.project.create({
    data: {
      name,
      description: data.description?.trim() || null,
      slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
      testCasePrefix: prefix,
      members: {
        create: { userId, role: "ADMIN" },
      },
    },
  });
}

export async function userIsProjectAdmin(userId: string, projectId: string): Promise<boolean> {
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return member?.role === "ADMIN";
}

export async function getProjectRole(
  userId: string,
  projectId: string
): Promise<"ADMIN" | "MEMBER" | "VIEWER" | null> {
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

export async function userHasProjectAccess(userId: string, projectId: string) {
  const member = await db.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
  });

  return Boolean(member);
}
