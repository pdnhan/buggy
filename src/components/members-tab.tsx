"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type MemberRow = {
  userId: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  createdAt: Date;
};

type LookupResult =
  | { found: true; user: { id: string; name: string | null; email: string } }
  | { found: false; openRegistration: boolean };

type Props = {
  projectId: string;
  currentUserId: string;
  initialMembers: MemberRow[];
};

export function MembersTab({ projectId, currentUserId, initialMembers }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);

  useEffect(() => { setMembers(initialMembers); }, [initialMembers]);

  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupRole, setLookupRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">("MEMBER");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [adding, setAdding] = useState(false);

  const adminCount = members.filter((m) => m.role === "ADMIN").length;

  // Check if the found user is already a member (client-side, no extra API call)
  const alreadyMember =
    lookupResult?.found === true &&
    members.some((m) => m.userId === lookupResult.user.id);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupResult(null);
    setLooking(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/members/lookup?email=${encodeURIComponent(lookupEmail.trim().toLowerCase())}`
      );
      const data = (await res.json()) as LookupResult;
      setLookupResult(data);
    } catch {
      toast.error("Lookup failed.");
    } finally {
      setLooking(false);
    }
  }

  async function handleAdd() {
    if (!lookupResult?.found) return;
    const { user } = lookupResult;
    setAdding(true);

    const prev = members;
    const newMember: MemberRow = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: lookupRole,
      createdAt: new Date(),
    };
    setMembers((m) => [...m, newMember]);
    setLookupResult(null);
    setLookupEmail("");

    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: lookupRole }),
      });
      if (!res.ok) {
        setMembers(prev);
        if (res.status === 409) {
          toast.error("This user is already a member of the project.");
          router.refresh();
        } else {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? "Failed to add member.");
        }
      }
    } catch {
      setMembers(prev);
      toast.error("Network error.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(member: MemberRow, newRole: "ADMIN" | "MEMBER" | "VIEWER") {
    const prev = members;
    setMembers((m) => m.map((x) => (x.userId === member.userId ? { ...x, role: newRole } : x)));

    try {
      const res = await fetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        setMembers(prev);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to change role.");
      }
    } catch {
      setMembers(prev);
      toast.error("Network error. Role was not changed.");
    }
  }

  async function handleRemove(member: MemberRow) {
    const prev = members;
    setMembers((m) => m.filter((x) => x.userId !== member.userId));

    try {
      const res = await fetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        setMembers(prev);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to remove member.");
      }
    } catch {
      setMembers(prev);
      toast.error("Network error. Member was not removed.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Add member */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium">Add member</h3>
        <form onSubmit={handleLookup} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48 space-y-1">
            <label htmlFor="lookup-email" className="block text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="lookup-email"
              type="email"
              value={lookupEmail}
              onChange={(e) => { setLookupEmail(e.target.value); setLookupResult(null); }}
              placeholder="user@example.com"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="lookup-role" className="block text-xs font-medium text-muted-foreground">
              Role
            </label>
            <select
              id="lookup-role"
              value={lookupRole}
              onChange={(e) => setLookupRole(e.target.value as "ADMIN" | "MEMBER" | "VIEWER")}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={looking}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {looking ? "Looking up…" : "Look up"}
          </button>
        </form>

        {/* Found — already a member */}
        {alreadyMember && lookupResult?.found && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            {lookupResult.user.name ?? lookupResult.user.email} is already a member of this project.
          </div>
        )}

        {/* Found — can add */}
        {!alreadyMember && lookupResult?.found && (
          <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm dark:border-green-900 dark:bg-green-950/20">
            <span className="text-green-800 dark:text-green-300">
              {lookupResult.user.name ? `${lookupResult.user.name} — ` : ""}
              {lookupResult.user.email}
            </span>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="ml-3 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add to project"}
            </button>
          </div>
        )}

        {/* Not found */}
        {lookupResult && !lookupResult.found && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            {lookupResult.openRegistration ? (
              <>
                No user found for <strong>{lookupEmail}</strong>. They can sign up themselves at{" "}
                <a
                  href={`${window.location.origin}/register`}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {window.location.origin}/register
                </a>
                , then you can add them here.
              </>
            ) : (
              <>
                No user found for <strong>{lookupEmail}</strong>. Registration is currently
                closed. Ask a workspace admin to create their account in Admin → Users, or enable
                open registration in Admin → Settings.
              </>
            )}
          </div>
        )}
      </div>

      {/* Members table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Since</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const isLastAdmin = member.role === "ADMIN" && adminCount <= 1;
              return (
                <tr key={member.userId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {member.name ?? "—"}
                      {isSelf && (
                        <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {isSelf && isLastAdmin ? (
                      <span className="text-sm">Admin</span>
                    ) : (
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(member, e.target.value as "ADMIN" | "MEMBER" | "VIEWER")
                        }
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="MEMBER">Member</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(member)}
                      disabled={isSelf && isLastAdmin}
                      title={
                        isSelf && isLastAdmin ? "Cannot remove the only project admin" : undefined
                      }
                      className="text-sm text-destructive hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
