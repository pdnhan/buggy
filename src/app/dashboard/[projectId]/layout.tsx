import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userHasProjectAccess } from "@/lib/projects";
import { getFeatureFlags } from "@/lib/feature-flags";
import { DashboardNav } from "@/components/dashboard-nav";
import { RdThemeToggle } from "@/components/rd-theme-toggle";
import { LogoutButton } from "@/components/logout-button";

const OPEN_BUG_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "READY_FOR_QA",
  "IN_QA",
  "FIXED",
  "REOPENED",
] as const;

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

  const [testsCount, bugsCount] = await Promise.all([
    db.testCase.count({ where: { projectId } }),
    flags.enableBugTracking
      ? db.bug.count({ where: { projectId, status: { in: [...OPEN_BUG_STATUSES] } } }).catch(() => 0)
      : Promise.resolve(0),
  ]);

  const email = session.user.email ?? "";
  const initials =
    (email.split("@")[0] || "?")
      .split(/[.\-_]/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  const prefixBadge = project.testCasePrefix.slice(0, 3).toUpperCase();

  return (
    <div className="rd-shell relative flex min-h-screen">
      {/* ── Rail ── */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-[var(--rd-border)] bg-[var(--rd-bg)]">
        {/* Brand */}
        <div className="flex h-[52px] items-center gap-2.5 border-b border-[var(--rd-border)] px-4">
          <span className="rd-mono flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--rd-accent)] text-[11px] font-semibold text-[var(--rd-on-accent)]">
            b
          </span>
          <span className="text-sm font-semibold tracking-tight">buggy</span>
        </div>

        {/* Project switcher */}
        <Link
          href="/dashboard"
          title="Switch project"
          className="mx-3 mt-3 mb-1 flex items-center gap-2.5 rounded-[7px] border border-[var(--rd-border)] bg-[var(--rd-panel)] px-2.5 py-2 transition-colors hover:border-[var(--rd-border2)]"
        >
          <span className="rd-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--rd-accent-soft)] text-[10px] font-semibold text-[var(--rd-accent)]">
            {prefixBadge}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={project.name}>
            {project.name}
          </span>
          <svg className="h-[13px] w-[13px] shrink-0 text-[var(--rd-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </Link>

        {/* Navigation */}
        <DashboardNav
          projectId={project.id}
          showBugTracking={flags.enableBugTracking}
          showAdmin={!!session.user.isWorkspaceAdmin}
          counts={{ tests: testsCount, bugs: bugsCount }}
        />

        {/* Footer */}
        <div className="flex flex-col gap-1.5 border-t border-[var(--rd-border)] px-3 py-2.5">
          <RdThemeToggle />
          <div className="flex items-center gap-2.5 px-2.5 py-1">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--rd-panel2)] text-[10px] font-semibold text-[var(--rd-muted)]">
              {initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--rd-muted)]" title={email}>
              {email}
            </span>
            <LogoutButton variant="icon" />
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
