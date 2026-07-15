"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AdminLayout } from "../layout-client";

type Flags = {
  enableSessionTesting: boolean;
  enableReleaseTracking: boolean;
  openRegistration: boolean;
  enableBugTracking: boolean;
};

const FLAG_META: {
  key: keyof Flags;
  label: string;
  description: string;
}[] = [
  {
    key: "enableSessionTesting",
    label: "Session Testing",
    description: "Show the Session Testing section in project dashboards.",
  },
  {
    key: "enableReleaseTracking",
    label: "Release Tracking",
    description: "Show the Release Tracking section in project dashboards.",
  },
  {
    key: "enableBugTracking",
    label: "Bug Quality Tracking",
    description: "Show the Bugs register and Quality dashboard in project dashboards.",
  },
  {
    key: "openRegistration",
    label: "Open Registration",
    description:
      "Allow anyone with the link to register a new account. When off, only workspace admins can invite users.",
  },
];

export function AdminFlagsClient({ initialFlags }: { initialFlags: Flags }) {
  const [flags, setFlags] = useState(initialFlags);
  const [saving, setSaving] = useState<keyof Flags | null>(null);

  async function handleToggle(key: keyof Flags) {
    const newValue = !flags[key];
    setFlags((prev) => ({ ...prev, [key]: newValue }));
    setSaving(key);

    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: newValue }),
    });

    setSaving(null);

    if (!res.ok) {
      setFlags((prev) => ({ ...prev, [key]: !newValue }));
      const data = (await res.json()) as { error?: string };
      toast.error(data.error ?? "Failed to update setting.");
      return;
    }

    toast.success("Setting updated.");
  }

  return (
    <AdminLayout activeTab="flags">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Feature Flags</h2>
          <p className="text-sm text-muted-foreground">
            Enable or disable workspace-wide features.
          </p>
        </div>

        <div className="rounded-lg border border-border divide-y divide-border">
          {FLAG_META.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between px-4 py-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </div>
              <Switch
                checked={flags[key]}
                onCheckedChange={() => handleToggle(key)}
                disabled={saving === key}
                aria-label={label}
              />
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
