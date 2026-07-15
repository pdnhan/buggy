import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AdminFlagsClient } from "./flags-client";

export default async function AdminFlagsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!session.user.isWorkspaceAdmin) redirect("/dashboard");

  const settings = await db.workspaceSettings.findFirst();

  return (
    <AdminFlagsClient
      initialFlags={{
        enableSessionTesting: settings?.enableSessionTesting ?? false,
        enableReleaseTracking: settings?.enableReleaseTracking ?? false,
        openRegistration: settings?.openRegistration ?? false,
        enableBugTracking: settings?.enableBugTracking ?? false,
      }}
    />
  );
}
