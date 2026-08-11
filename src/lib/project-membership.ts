import { db } from "@/lib/db";

// Validates that every supplied user id (assignee/QA owner/reporter/...) is
// actually a member of the target project. Without this, any caller could
// pass an arbitrary (cross-tenant) user id and: (1) have a route's `include`
// leak that user's name/email back to them, and (2) forge bug provenance
// (attribute a bug/reopen event to someone who never touched it).
//
// Shared by every write route that accepts an assignee-shaped user id —
// POST /api/bugs, PUT /api/bugs/[id], POST /api/v1/bugs, PATCH
// /api/v1/bugs/[id], and POST /api/v1/bugs/[id]/reopen — the check was
// byte-for-byte duplicated across the first four before being pulled out
// here (CQ-105).
export async function findNonMemberIds(
  projectId: string,
  ids: Array<string | null | undefined>
): Promise<string[]> {
  const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return [];

  const members = await db.projectMember.findMany({
    where: { projectId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((m) => m.userId));
  return uniqueIds.filter((id) => !memberIds.has(id));
}
