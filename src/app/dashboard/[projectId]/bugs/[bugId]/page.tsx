import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/projects";
import { getFeatureFlags } from "@/lib/feature-flags";
import { BugDetailPanel } from "@/components/bug-detail-panel";

export default async function BugDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; bugId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { projectId, bugId } = await params;

  const role = await getProjectRole(session.user.id, projectId);
  if (!role) notFound();

  const flags = await getFeatureFlags();
  if (!flags.enableBugTracking) notFound();

  const bug = await db.bug.findUnique({
    where: { id: bugId },
    include: {
      module: true,
      assignedDeveloper: { select: { id: true, name: true, email: true } },
      responsibleQa: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
      reopenEvents: {
        orderBy: { sequenceNumber: "asc" },
        include: {
          reopenedBy: { select: { id: true, name: true, email: true } },
          assignedDeveloper: { select: { id: true, name: true, email: true } },
          responsibleQa: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!bug || bug.projectId !== projectId) notFound();

  const modules = await db.module.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const members = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <BugDetailPanel
        projectId={projectId}
        role={role}
        bug={{
          ...bug,
          createdAt: bug.createdAt.toISOString(),
          updatedAt: bug.updatedAt.toISOString(),
          firstDetectedDate: bug.firstDetectedDate?.toISOString() ?? null,
          firstFixedDate: bug.firstFixedDate?.toISOString() ?? null,
          lastFixedDate: bug.lastFixedDate?.toISOString() ?? null,
          closedDate: bug.closedDate?.toISOString() ?? null,
          firstReopenedDate: bug.firstReopenedDate?.toISOString() ?? null,
          lastReopenedDate: bug.lastReopenedDate?.toISOString() ?? null,
          reopenEvents: bug.reopenEvents.map((event) => ({
            ...event,
            reopenedAt: event.reopenedAt.toISOString(),
          })),
        }}
        modules={modules}
        members={members.map((m) => m.user)}
      />
    </main>
  );
}
