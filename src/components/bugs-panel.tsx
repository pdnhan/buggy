"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BUG_SEVERITIES,
  BUG_PRIORITIES,
  BUG_STATUSES,
  DETECTION_SOURCES,
  DETECTION_PHASES,
  ROOT_CAUSES,
  bugSeverityLabel,
  bugStatusLabel,
  detectionPhaseLabel,
} from "@/lib/bug-enums";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonRef = { id: string; name: string | null; email: string } | null;

export type BugItem = {
  id: string;
  displayId: string;
  title: string;
  description?: string | null;
  severity: string;
  priority: string;
  status: string;
  detectionSource: string;
  detectionPhase: string;
  rootCause?: string | null;
  bugType?: string | null;
  environment?: string | null;
  isLeaked: boolean;
  leakageOverridden: boolean;
  leakageOverrideReason?: string | null;
  isRegression: boolean;
  reopenCount: number;
  module: { id: string; name: string } | null;
  assignedDeveloper: PersonRef;
  responsibleQa: PersonRef;
  reporter: PersonRef;
  sprint?: string | null;
  release?: string | null;
  fixVersion?: string | null;
  externalIssueId?: string | null;
  issueTrackerUrl?: string | null;
  clientImpact?: string | null;
  businessImpact?: string | null;
  reproductionSteps?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  notes?: string | null;
  labels?: string[];
  createdAt: string;
  closedDate?: string | null;
};

export type MemberOption = { id: string; name: string | null; email: string };

type Props = {
  projectId: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  bugs: BugItem[];
  modules: { id: string; name: string }[];
  members: MemberOption[];
};

// ─── Style maps ───────────────────────────────────────────────────────────────

export const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

export const STATUS_DOT: Record<string, string> = {
  OPEN: "bg-muted-foreground",
  IN_PROGRESS: "bg-[var(--warning)]",
  READY_FOR_QA: "bg-[var(--warning)]",
  IN_QA: "bg-[var(--warning)]",
  FIXED: "bg-[var(--success)]",
  RESOLVED: "bg-[var(--success)]",
  CLOSED: "bg-[var(--success)]",
  REOPENED: "bg-destructive",
  REJECTED: "bg-muted-foreground",
  DUPLICATE: "bg-muted-foreground",
  CANNOT_REPRODUCE: "bg-muted-foreground",
  DEFERRED: "bg-muted-foreground",
};

// ─── Shared form fields ───────────────────────────────────────────────────────

export function BugFormFields({
  defaults,
  modules,
  members,
  showStatus,
}: {
  defaults?: Partial<BugItem>;
  modules: { id: string; name: string }[];
  members: MemberOption[];
  showStatus?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="bug-title">Title *</Label>
        <Input
          id="bug-title"
          name="title"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. Checkout fails when applying a discount code"
          defaultValue={defaults?.title ?? ""}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="bug-description">Description</Label>
        <textarea
          id="bug-description"
          name="description"
          placeholder="What's wrong, and what did you expect instead?"
          defaultValue={defaults?.description ?? ""}
          className="h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="bug-severity">Severity *</Label>
          <select
            id="bug-severity"
            name="severity"
            required
            defaultValue={defaults?.severity ?? "MEDIUM"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BUG_SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bug-priority">Priority</Label>
          <select
            id="bug-priority"
            name="priority"
            defaultValue={defaults?.priority ?? "MEDIUM"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BUG_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="bug-detectionPhase">Detection phase *</Label>
          <select
            id="bug-detectionPhase"
            name="detectionPhase"
            required
            defaultValue={defaults?.detectionPhase ?? "QA"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {DETECTION_PHASES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            UAT, client acceptance, and production are automatically classified as leaked.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bug-detectionSource">Detection source</Label>
          <select
            id="bug-detectionSource"
            name="detectionSource"
            defaultValue={defaults?.detectionSource ?? "QA"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {DETECTION_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {showStatus && (
        <div className="space-y-1">
          <Label htmlFor="bug-status">Status</Label>
          <select
            id="bug-status"
            name="status"
            defaultValue={defaults?.status ?? "OPEN"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BUG_STATUSES.filter((s) => s.value !== "REOPENED").map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            To reopen a bug, use the &ldquo;Reopen&rdquo; action instead — it requires a reason.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="bug-module">Module</Label>
          <Input
            id="bug-module"
            name="moduleName"
            type="text"
            list="bug-module-options"
            placeholder="e.g. Checkout"
            defaultValue={defaults?.module?.name ?? ""}
          />
          <datalist id="bug-module-options">
            {modules.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bug-environment">Environment</Label>
          <Input id="bug-environment" name="environment" type="text" placeholder="e.g. staging" defaultValue={defaults?.environment ?? ""} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="bug-assignedDeveloperId">Assigned developer</Label>
          <select
            id="bug-assignedDeveloperId"
            name="assignedDeveloperId"
            defaultValue={defaults?.assignedDeveloper?.id ?? ""}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">— Unassigned —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bug-responsibleQaId">Responsible QA</Label>
          <select
            id="bug-responsibleQaId"
            name="responsibleQaId"
            defaultValue={defaults?.responsibleQa?.id ?? ""}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">— Unassigned —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="bug-rootCause">Root cause</Label>
        <select
          id="bug-rootCause"
          name="rootCause"
          defaultValue={defaults?.rootCause ?? ""}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">— Not yet determined —</option>
          {ROOT_CAUSES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Required before closing critical, high-severity, leaked, or reopened bugs.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="bug-isRegression"
          name="isRegression"
          type="checkbox"
          defaultChecked={defaults?.isRegression ?? false}
          className="rounded border-border"
        />
        <Label htmlFor="bug-isRegression" className="font-normal">This is a regression</Label>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {showAdvanced ? "Hide additional fields" : "Additional fields"}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bug-sprint">Sprint</Label>
              <Input id="bug-sprint" name="sprint" type="text" defaultValue={defaults?.sprint ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-release">Release</Label>
              <Input id="bug-release" name="release" type="text" defaultValue={defaults?.release ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-fixVersion">Fix version</Label>
              <Input id="bug-fixVersion" name="fixVersion" type="text" defaultValue={defaults?.fixVersion ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bug-externalIssueId">External issue ID</Label>
              <Input id="bug-externalIssueId" name="externalIssueId" type="text" placeholder="JIRA-123" defaultValue={defaults?.externalIssueId ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-issueTrackerUrl">Issue tracker URL</Label>
              <Input id="bug-issueTrackerUrl" name="issueTrackerUrl" type="url" defaultValue={defaults?.issueTrackerUrl ?? ""} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bug-bugType">Bug type</Label>
            <Input id="bug-bugType" name="bugType" type="text" placeholder="e.g. Functional, UI, Performance" defaultValue={defaults?.bugType ?? ""} />
          </div>
        </div>
      )}
    </>
  );
}

export function buildBugPayload(form: HTMLFormElement) {
  const formData = new FormData(form);
  const str = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v || undefined;
  };
  return {
    title: String(formData.get("title") ?? "").trim(),
    description: str("description"),
    severity: String(formData.get("severity") ?? "MEDIUM"),
    priority: String(formData.get("priority") ?? "MEDIUM"),
    detectionPhase: String(formData.get("detectionPhase") ?? "QA"),
    detectionSource: String(formData.get("detectionSource") ?? "QA"),
    status: formData.has("status") ? String(formData.get("status")) : undefined,
    moduleName: str("moduleName"),
    environment: str("environment"),
    assignedDeveloperId: str("assignedDeveloperId"),
    responsibleQaId: str("responsibleQaId"),
    rootCause: str("rootCause"),
    isRegression: formData.get("isRegression") === "on",
    sprint: str("sprint"),
    release: str("release"),
    fixVersion: str("fixVersion"),
    externalIssueId: str("externalIssueId"),
    issueTrackerUrl: str("issueTrackerUrl"),
    bugType: str("bugType"),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BugsPanel({ projectId, role, bugs, modules, members }: Props) {
  const router = useRouter();
  const canWrite = role !== "VIEWER";
  const canDelete = role === "ADMIN";

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [leakedFilter, setLeakedFilter] = useState("ALL");
  const [reopenedFilter, setReopenedFilter] = useState("ALL");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<BugItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BugItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredBugs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bugs.filter((b) => {
      if (q) {
        const haystack = `${b.displayId} ${b.title} ${b.externalIssueId ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (severityFilter !== "ALL" && b.severity !== severityFilter) return false;
      if (statusFilter !== "ALL" && b.status !== statusFilter) return false;
      if (leakedFilter === "YES" && !b.isLeaked) return false;
      if (leakedFilter === "NO" && b.isLeaked) return false;
      if (reopenedFilter === "YES" && b.reopenCount === 0) return false;
      if (reopenedFilter === "NO" && b.reopenCount > 0) return false;
      return true;
    });
  }, [bugs, search, severityFilter, statusFilter, leakedFilter, reopenedFilter]);

  const activeFilterCount = [
    severityFilter !== "ALL",
    statusFilter !== "ALL",
    leakedFilter !== "ALL",
    reopenedFilter !== "ALL",
  ].filter(Boolean).length;

  async function createBug(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setCreating(true);
    const payload = buildBugPayload(form);
    const toastId = toast.loading("Creating bug…");

    try {
      const response = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, projectId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to create bug.", { id: toastId });
        return;
      }
      toast.success("Bug created.", { id: toastId });
      form.reset();
      setShowCreateDialog(false);
      router.refresh();
    } catch {
      toast.error("Network error.", { id: toastId });
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    const payload = buildBugPayload(event.currentTarget);
    const toastId = toast.loading("Saving changes…");

    try {
      const response = await fetch(`/api/bugs/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, moduleName: payload.moduleName ?? null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to update bug.", { id: toastId });
        return;
      }
      toast.success("Bug updated.", { id: toastId });
      setEditTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error.", { id: toastId });
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/bugs/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to delete bug.");
        return;
      }
      toast.success("Bug deleted.");
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setDeleting(false);
    }
  }

  function exportCsvHref() {
    const params = new URLSearchParams({ projectId });
    if (severityFilter !== "ALL") params.set("severity", severityFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (leakedFilter !== "ALL") params.set("leaked", leakedFilter === "YES" ? "true" : "false");
    if (reopenedFilter !== "ALL") params.set("reopened", reopenedFilter === "YES" ? "true" : "false");
    if (search.trim()) params.set("search", search.trim());
    return `/api/bugs/export?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bug Register</h1>
          <p className="text-sm text-muted-foreground">{bugs.length} bug{bugs.length !== 1 ? "s" : ""} tracked</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={exportCsvHref()} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Export CSV
          </a>
          {canWrite && <Button onClick={() => setShowCreateDialog(true)}>New bug</Button>}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID, title, or issue ID…"
          className="max-w-xs"
        />
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="ALL">All severities</option>
          {BUG_SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="ALL">All statuses</option>
          {BUG_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={leakedFilter} onChange={(e) => setLeakedFilter(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="ALL">Leaked: any</option>
          <option value="YES">Leaked: yes</option>
          <option value="NO">Leaked: no</option>
        </select>
        <select value={reopenedFilter} onChange={(e) => setReopenedFilter(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="ALL">Reopened: any</option>
          <option value="YES">Reopened: yes</option>
          <option value="NO">Reopened: no</option>
        </select>
        {activeFilterCount > 0 && (
          <span className="text-xs text-muted-foreground">{activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active</span>
        )}
      </div>

      {/* ── Table ── */}
      {filteredBugs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
          {bugs.length === 0 ? (
            <>
              <p className="text-sm font-medium">No bugs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Register your first bug to start tracking quality.</p>
              {canWrite && (
                <div className="mt-4 flex justify-center">
                  <Button onClick={() => setShowCreateDialog(true)}>New bug</Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No bugs match your filters.</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Bug ID</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Title</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground sm:table-cell">Severity</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground md:table-cell">Phase</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground md:table-cell">Leaked</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground lg:table-cell">Reopens</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {filteredBugs.map((bug) => (
                <tr key={bug.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/dashboard/${projectId}/bugs/${bug.id}`} className="hover:underline">
                      {bug.displayId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/${projectId}/bugs/${bug.id}`} className="hover:underline">
                      {bug.title}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge variant={SEVERITY_VARIANT[bug.severity] ?? "outline"}>{bugSeverityLabel(bug.severity)}</Badge>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{detectionPhaseLabel(bug.detectionPhase)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[bug.status] ?? "bg-muted-foreground")} />
                      {bugStatusLabel(bug.status)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {bug.isLeaked ? <Badge variant="destructive">Leaked</Badge> : <span className="text-muted-foreground">No</span>}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">{bug.reopenCount > 0 ? bug.reopenCount : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {canWrite && (
                        <button onClick={() => setEditTarget(bug)} className="text-xs text-muted-foreground hover:text-foreground">
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => setDeleteTarget(bug)} className="text-xs text-destructive hover:text-destructive/80">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>New bug</DialogTitle>
            <DialogDescription>Register a bug for this project.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={createBug}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <BugFormFields modules={modules} members={members} />
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="w-full sm:w-auto">{creating ? "Saving…" : "Create bug"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>Edit bug {editTarget?.displayId}</DialogTitle>
            <DialogDescription>Update the bug details.</DialogDescription>
          </DialogHeader>
          <form key={editTarget?.id} className="flex min-h-0 flex-1 flex-col" onSubmit={saveEdit}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <BugFormFields defaults={editTarget ?? undefined} modules={modules} members={members} showStatus />
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={savingEdit} className="w-full sm:w-auto">{savingEdit ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[min(95vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Delete bug?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; and its reopen history will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
