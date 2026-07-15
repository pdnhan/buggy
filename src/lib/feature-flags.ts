import { cache } from "react";
import { db } from "@/lib/db";

// Wrapped in React.cache() to deduplicate within a single request.
// Per-request only — flags are always fresh after a PATCH to /api/admin/settings.
export const getFeatureFlags = cache(async () => {
  const settings = await db.workspaceSettings.findFirst();
  return {
    enableSessionTesting:
      settings?.enableSessionTesting ??
      process.env.ENABLE_SESSION_TESTING === "true",
    enableReleaseTracking:
      settings?.enableReleaseTracking ??
      process.env.ENABLE_RELEASE_TRACKING === "true",
    openRegistration: settings?.openRegistration ?? false,
    enableBugTracking:
      settings?.enableBugTracking ?? process.env.ENABLE_BUG_TRACKING === "true",
  };
});
