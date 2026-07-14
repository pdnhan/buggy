"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";

const BuggyLogo = () => (
  <div className="mb-8 flex items-center gap-2">
    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
      <svg
        className="h-4 w-4 text-background"
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
    <span className="text-sm font-bold tracking-tight">Buggy</span>
  </div>
);

const flags = [
  {
    key: "openRegistration" as const,
    label: "Open Registration",
    description: "Allow anyone to create an account. When off, only admins can add users.",
    envVar: "—",
  },
  {
    key: "enableSessionTesting" as const,
    label: "Session Testing",
    description: "Enable exploratory session tracking in all projects.",
    envVar: "ENABLE_SESSION_TESTING",
  },
  {
    key: "enableReleaseTracking" as const,
    label: "Release Tracking",
    description: "Enable release and defect report tracking in all projects.",
    envVar: "ENABLE_RELEASE_TRACKING",
  },
  {
    key: "enableBugTracking" as const,
    label: "Bug Quality Tracking",
    description: "Enable the bug register and monthly quality dashboard in all projects.",
    envVar: "ENABLE_BUG_TRACKING",
  },
];

type FlagKey =
  | "openRegistration"
  | "enableSessionTesting"
  | "enableReleaseTracking"
  | "enableBugTracking";

export default function SetupSettingsPage() {
  const router = useRouter();
  const [values, setValues] = useState<Record<FlagKey, boolean>>({
    openRegistration: false,
    enableSessionTesting: false,
    enableReleaseTracking: false,
    enableBugTracking: false,
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSkip() {
    router.push("/dashboard");
  }

  async function handleSave() {
    setSaving(true);
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSaving(false);
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 py-12">
        <BuggyLogo />
        <div className="flex flex-col items-center gap-4 text-center">
          <svg
            className="h-12 w-12 text-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h1 className="text-2xl font-semibold">Workspace ready.</h1>
          <p className="text-sm text-muted-foreground">
            Your admin account is set up. You can change these settings anytime
            from /admin.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-2 rounded-lg bg-primary px-6 py-2 font-medium text-primary-foreground transition hover:opacity-90"
          >
            Open Dashboard
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-12">
      <BuggyLogo />

      <div className="flex gap-8">
        {/* Step tracker */}
        <ol className="hidden shrink-0 flex-col gap-4 pt-1 sm:flex" style={{ width: 180 }}>
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs text-background">
              ✓
            </span>
            Create account
          </li>
          <li className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-foreground text-xs font-bold">
              2
            </span>
            Configure workspace
          </li>
        </ol>

        {/* Form */}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Configure workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            These settings can be changed anytime from /admin.
          </p>

          <div className="mt-6 space-y-6">
            {flags.map(({ key, label, description, envVar }) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <label className="text-sm font-medium" htmlFor={`flag-${key}`}>
                    {label}
                  </label>
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                  {envVar !== "—" && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      env: {envVar}
                    </p>
                  )}
                </div>
                <Switch
                  id={`flag-${key}`}
                  checked={values[key]}
                  onCheckedChange={(checked) =>
                    setValues((prev) => ({ ...prev, [key]: checked }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save and continue"}
            </button>
            <button
              onClick={handleSkip}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Skip for now — change these anytime
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
