import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SetupSettingsForm } from "./settings-form";

// CQ-124: this page toggles workspace-wide feature flags (via
// /api/admin/settings) and used to be a bare "use client" page with no
// auth() call at all — anyone who found the URL could open it. src/proxy.ts
// now locks /setup/settings the same way it locks /admin/** once setup is
// complete, but that's belt-and-suspenders; the authoritative check lives
// here, matching every other admin-only page in this app (see
// src/app/admin/page.tsx).
export default async function SetupSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!session.user.isWorkspaceAdmin) redirect("/dashboard");

  return <SetupSettingsForm />;
}
