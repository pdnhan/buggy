"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ─── Icons (single-path, matching the redesign rail) ───────────────────────────

const ICON: Record<string, string> = {
  Overview:
    "M3 4.5A1.5 1.5 0 014.5 3h4A1.5 1.5 0 0110 4.5v4A1.5 1.5 0 018.5 10h-4A1.5 1.5 0 013 8.5v-4z M14 4.5A1.5 1.5 0 0115.5 3h4A1.5 1.5 0 0121 4.5v4A1.5 1.5 0 0119.5 10h-4A1.5 1.5 0 0114 8.5v-4z M3 15.5A1.5 1.5 0 014.5 14h4A1.5 1.5 0 0110 15.5v4A1.5 1.5 0 018.5 21h-4A1.5 1.5 0 013 19.5v-4z M14 15.5A1.5 1.5 0 0115.5 14h4a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5h-4a1.5 1.5 0 01-1.5-1.5v-4z",
  Tests:
    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M10 3h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V4a1 1 0 011-1z M9 12l2 2 4-4",
  Metrics:
    "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  Bugs:
    "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M12 4.5v3m0 9v3m-7.5-7.5h3m9 0h3M6.34 6.34l2.12 2.12m6.88 6.88l2.12 2.12M6.34 17.66l2.12-2.12m6.88-6.88l2.12-2.12 M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z",
  Quality: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  Settings:
    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  Admin:
    "M16 7a4 4 0 11-8 0 4 4 0 018 0z M12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
};

type NavItem = { href: string; label: string; count?: number | null; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

function buildGroups(
  projectId: string,
  opts: { showBugTracking: boolean; showAdmin: boolean; counts?: { tests?: number; bugs?: number } }
): NavGroup[] {
  const c = opts.counts ?? {};
  const groups: NavGroup[] = [
    {
      label: "project",
      items: [
        { href: `/dashboard/${projectId}`, label: "Overview", exact: true },
        { href: `/dashboard/${projectId}/tests`, label: "Tests", count: c.tests ?? null },
        { href: `/dashboard/${projectId}/metrics`, label: "Metrics" },
      ],
    },
  ];
  if (opts.showBugTracking) {
    groups.push({
      label: "quality",
      items: [
        { href: `/dashboard/${projectId}/bugs`, label: "Bugs", count: c.bugs ?? null },
        { href: `/dashboard/${projectId}/quality`, label: "Quality" },
      ],
    });
  }
  const workspace: NavItem[] = [{ href: `/dashboard/${projectId}/settings`, label: "Settings" }];
  if (opts.showAdmin) workspace.push({ href: "/admin", label: "Admin" });
  groups.push({ label: "workspace", items: workspace });
  return groups;
}

export function DashboardNav({
  projectId,
  showBugTracking = false,
  showAdmin = false,
  counts,
}: {
  projectId: string;
  showBugTracking?: boolean;
  showAdmin?: boolean;
  counts?: { tests?: number; bugs?: number };
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pt-3">
      {buildGroups(projectId, { showBugTracking, showAdmin, counts }).map((group) => (
        <div key={group.label} className="flex flex-col gap-px">
          <p className="rd-mono mb-1 px-2.5 text-[10px] uppercase tracking-[0.14em] text-[var(--rd-faint)]">
            {group.label}
          </p>
          {group.items.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors"
                style={{
                  background: isActive ? "var(--rd-panel2)" : "transparent",
                  color: isActive ? "var(--rd-text)" : "var(--rd-muted)",
                  boxShadow: isActive ? "inset 2px 0 0 var(--rd-accent)" : "none",
                }}
              >
                <svg
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={ICON[item.label]} />
                </svg>
                {item.label}
                {item.count != null && (
                  <span className="rd-mono ml-auto text-[10px] text-[var(--rd-faint)]">
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
