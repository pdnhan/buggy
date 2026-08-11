"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AdminLayout } from "./layout-client";

type User = {
  id: string;
  name: string | null;
  email: string;
  isWorkspaceAdmin: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  _count: { projects: number };
};

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function AdminUsersClient({
  initialUsers,
  currentUserId,
}: {
  initialUsers: User[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);

  useEffect(() => { setUsers(initialUsers); }, [initialUsers]);

  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // Create user dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function openCreateDialog() {
    setCreateEmail("");
    setCreateName("");
    setCreateError(null);
    setCreating(false);
    setCreatedPassword(null);
    setCopied(false);
    setCreateOpen(true);
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: createEmail.trim().toLowerCase(), name: createName.trim() || undefined }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setCreateError(data.error ?? "Failed to create user.");
        return;
      }

      const data = (await res.json()) as { user: User; tempPassword: string };
      setUsers((prev) => [...prev, data.user]);
      setCreatedPassword(data.tempPassword);
    } catch {
      setCreateError("Network error. Failed to create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyPassword() {
    if (!createdPassword) return;
    await navigator.clipboard.writeText(createdPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const adminCount = users.filter((u) => u.isWorkspaceAdmin).length;

  async function handlePromote(user: User) {
    const newValue = !user.isWorkspaceAdmin;
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isWorkspaceAdmin: newValue } : u))
    );

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isWorkspaceAdmin: newValue }),
      });

      if (!res.ok) {
        // Snap back
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isWorkspaceAdmin: user.isWorkspaceAdmin } : u))
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to update role.");
        return;
      }

      const action = newValue ? "promoted" : "demoted";
      toast.success(
        `${user.name ?? user.email} ${action}. Changes take effect when they next sign in.`
      );
    } catch {
      // Snap back
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isWorkspaceAdmin: user.isWorkspaceAdmin } : u))
      );
      toast.error("Network error. Role was not updated.");
    }
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);

    try {
      const res = await fetch(`/api/admin/users/${removeTarget.id}`, { method: "DELETE" });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRemoveError(data.error ?? "Failed to remove user.");
        return;
      }

      setUsers((prev) => prev.filter((u) => u.id !== removeTarget.id));
      toast.success(`${removeTarget.name ?? removeTarget.email} has been removed.`);
      setRemoveTarget(null);
    } catch {
      setRemoveError("Network error. Failed to remove user.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleResetConfirm() {
    if (!resetTarget) return;
    setResetting(true);

    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, { method: "POST" });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to reset password.");
        setResetTarget(null);
        return;
      }

      const data = (await res.json()) as { tempPassword: string };
      setResetPassword(data.tempPassword);
      setResetCopied(false);
      setUsers((prev) =>
        prev.map((u) => (u.id === resetTarget.id ? { ...u, mustChangePassword: true } : u))
      );
      router.refresh();
    } catch {
      toast.error("Network error. Failed to reset password.");
      setResetTarget(null);
    } finally {
      setResetting(false);
    }
  }

  async function handleCopyResetPassword() {
    if (!resetPassword) return;
    await navigator.clipboard.writeText(resetPassword);
    setResetCopied(true);
    setTimeout(() => setResetCopied(false), 2000);
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Users</h2>
            <p className="text-sm text-muted-foreground">{users.length} workspace member{users.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={openCreateDialog}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            + Create user
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Projects</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Joined</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const isLastAdmin = user.isWorkspaceAdmin && adminCount <= 1;
                return (
                  <tr key={user.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {initials(user.name, user.email)}
                        </div>
                        <div>
                          <div className="font-medium">{user.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={user.isWorkspaceAdmin ? "default" : "outline"}>
                          {user.isWorkspaceAdmin ? "Workspace Admin" : "Member"}
                        </Badge>
                        {user.mustChangePassword && (
                          <Badge variant="outline" className="border-amber-400 text-amber-600">
                            Pending password
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user._count.projects}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!isSelf && (
                          <button
                            onClick={() => { setResetTarget(user); setResetPassword(null); }}
                            className="text-sm text-muted-foreground hover:text-foreground"
                            aria-label={`Reset password for ${user.name ?? user.email}`}
                          >
                            Reset password
                          </button>
                        )}
                        {!isSelf && (
                          <button
                            onClick={() => handlePromote(user)}
                            disabled={isLastAdmin && user.isWorkspaceAdmin}
                            className="text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`${user.isWorkspaceAdmin ? "Demote" : "Promote"} ${user.name ?? user.email}`}
                          >
                            {user.isWorkspaceAdmin ? "Demote" : "Promote"}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRemoveError(null);
                            setRemoveTarget(user);
                          }}
                          disabled={isSelf || isLastAdmin}
                          title={isLastAdmin ? "Cannot remove the only workspace admin" : undefined}
                          className="text-sm text-destructive hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Remove ${user.name ?? user.email}`}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              A temporary password will be generated. Share it manually with the new user — they
              will be required to change it on first sign-in.
            </DialogDescription>
          </DialogHeader>

          {createdPassword ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                User <strong>{createEmail}</strong> created. Share this temporary password:
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                <span className="flex-1 break-all select-all">{createdPassword}</span>
                <button
                  onClick={handleCopyPassword}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                This password will not be shown again after closing this dialog.
              </p>
              <DialogFooter>
                <button
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Done
                </button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label htmlFor="create-email" className="block text-sm font-medium mb-1">
                  Email
                </label>
                <input
                  id="create-email"
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="create-name" className="block text-sm font-medium mb-1">
                  Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="create-name"
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {creating ? "Creating…" : "Create user"}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove confirmation dialog */}
      <Dialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove user</DialogTitle>
            <DialogDescription>
              <strong>{removeTarget?.name ?? removeTarget?.email}</strong> will be removed
              from this workspace. Their test run history will be retained. This cannot be
              undone.
              <br />
              <span className="mt-1 block text-xs">
                Changes take effect when they next sign in.
              </span>
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p className="text-sm text-destructive">{removeError}</p>
          )}
          <DialogFooter>
            <button
              onClick={() => setRemoveTarget(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleRemoveConfirm}
              disabled={removing}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Reset password — confirmation dialog */}
      <Dialog open={resetTarget !== null && resetPassword === null} onOpenChange={(open) => { if (!open) setResetTarget(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              A new temporary password will be generated for{" "}
              <strong>{resetTarget?.name ?? resetTarget?.email}</strong>. They must change it on
              next sign-in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setResetTarget(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleResetConfirm}
              disabled={resetting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {resetting ? "Resetting…" : "Reset password"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password — temp password reveal dialog */}
      <Dialog open={resetPassword !== null} onOpenChange={(open) => { if (!open) { setResetPassword(null); setResetTarget(null); } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Share this password with <strong>{resetTarget?.name ?? resetTarget?.email}</strong>.
              They will be required to change it on next sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
            <span className="flex-1 break-all select-all">{resetPassword}</span>
            <button
              onClick={handleCopyResetPassword}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {resetCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            This password will not be shown again after closing this dialog.
          </p>
          <DialogFooter>
            <button
              onClick={() => { setResetPassword(null); setResetTarget(null); }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
