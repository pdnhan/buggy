import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/projects";
import { getFeatureFlags } from "@/lib/feature-flags";
import { BugsPanel } from "@/components/bugs-panel";

export default async function BugsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { projectId } = await params;

  const role = await getProjectRole(session.user.id, projectId);
  if (!role) notFound();

  const flags = await getFeatureFlags();
  if (!flags.enableBugTracking) notFound();

  const [bugs, modules, members] = await Promise.all([
    db.bug.findMany({
      where: { projectId },
      include: {
        module: true,
        assignedDeveloper: { select: { id: true, name: true, email: true } },
        responsibleQa: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.module.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <BugsPanel
        projectId={projectId}
        role={role}
        bugs={bugs.map((bug) => ({
          ...bug,
          createdAt: bug.createdAt.toISOString(),
          closedDate: bug.closedDate?.toISOString() ?? null,
        }))}
        modules={modules}
        members={members.map((m) => m.user)}
      />
    </main>
  );
}
