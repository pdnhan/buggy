import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess } from "@/lib/projects";
import { getFeatureFlags } from "@/lib/feature-flags";
import { DashboardNav } from "@/components/dashboard-nav";
import { CopyProjectId } from "@/components/copy-project-id";
import { LogoutButton } from "@/components/logout-button";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { projectId } = await params;

  if (
    !session.user.isWorkspaceAdmin &&
    !(await userHasProjectAccess(session.user.id, projectId))
  ) {
    notFound();
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, testCasePrefix: true },
  });

  if (!project) notFound();

  const flags = await getFeatureFlags();

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar">
        {/* Brand */}
        <div className="border-b border-sidebar-border px-4 py-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary">
              <svg
                className="h-3.5 w-3.5 text-primary-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
              Buggy
            </span>
          </div>

          {/* Project badge */}
          <Link
            href="/dashboard"
            className="group flex items-center gap-2.5 rounded-lg px-1 py-1 transition hover:bg-sidebar-accent/50"
            title="All projects"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary">
              {project.testCasePrefix.slice(0, 3)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-foreground" title={project.name}>
                {project.name}
              </p>
            </div>
            <svg
              className="ml-auto h-3.5 w-3.5 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60 transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 py-3">
          <DashboardNav projectId={project.id} showBugTracking={flags.enableBugTracking} />
        </div>

        {/* Footer actions */}
        <div className="flex flex-col gap-2 border-t border-sidebar-border px-3 py-4">
          <CopyProjectId projectId={project.id} />
          {session.user.isWorkspaceAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Admin Panel
            </Link>
          )}
          <LogoutButton />
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}
