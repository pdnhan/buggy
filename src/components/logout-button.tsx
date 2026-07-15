"use client";

import { signOut } from "next-auth/react";

export function LogoutButton({ variant = "default" }: { variant?: "default" | "icon" }) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        title="Sign out"
        className="shrink-0 rounded-md p-1 text-[var(--rd-faint)] transition-colors hover:bg-[var(--rd-panel2)] hover:text-[var(--rd-text)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
    >
      Sign out
    </button>
  );
}
