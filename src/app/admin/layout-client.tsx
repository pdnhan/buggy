"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

function ArrowLeftIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

const tabs = [
  { label: "Users", href: "/admin" },
  { label: "Feature Flags", href: "/admin/flags" },
  { label: "Projects", href: "/admin/projects" },
] as const;

export function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="text-sm font-semibold hover:opacity-70 transition-opacity">Buggy</Link>
          <span className="text-muted-foreground">›</span>
          <span className="text-sm text-muted-foreground">Admin</span>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden w-44 shrink-0 border-r border-border lg:block">
          <nav className="flex flex-col gap-1 p-3 pt-4">
            {tabs.map((tab) => {
              const isActive =
                tab.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
            <div className="mt-3 border-t border-border pt-3">
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <ArrowLeftIcon />
                Workspace
              </Link>
            </div>
          </nav>
        </aside>

        {/* Mobile tab bar */}
        <div className="w-full lg:hidden">
          <div className="flex border-b border-border px-4">
            {tabs.map((tab) => {
              const isActive =
                tab.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "px-4 py-3 text-sm transition-colors",
                    isActive
                      ? "border-b-2 border-foreground font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
