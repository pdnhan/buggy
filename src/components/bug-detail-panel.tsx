"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  BugFormFields,
  buildBugPayload,
  SEVERITY_VARIANT,
  STATUS_DOT,
  type BugItem,
  type MemberOption,
} from "@/components/bugs-panel";
import {
  bugSeverityLabel,
  bugPriorityLabel,
  bugStatusLabel,
  detectionSourceLabel,
  detectionPhaseLabel,
  rootCauseLabel,
  reopenReasonLabel,
  REOPEN_REASONS,
} from "@/lib/bug-enums";
import { cn } from "@/lib/utils";

const REOPENABLE_STATUSES = ["FIXED", "RESOLVED", "CLOSED"];

type ReopenEvent = {
  id: string;
  sequenceNumber: number;
  previousStatus: string;
  newStatus: string;
  reopenedAt: string;
  reason: string;
  environment: string | null;
  releaseOrBuild: string | null;
  comment: string | null;
  reopenedBy: { id: string; name: string | null; email: string };
  assignedDeveloper: { id: string; name: string | null; email: string } | null;
  responsibleQa: { id: string; name: string | null; email: string } | null;
};

type BugDetail = BugItem & {
  updatedAt: string;
  firstDetectedDate: string | null;
  firstFixedDate: string | null;
  lastFixedDate: string | null;
  firstReopenedDate: string | null;
  lastReopenedDate: string | null;
  reopenEvents: ReopenEvent[];
};

type Props = {
  projectId: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  bug: BugDetail;
  modules: { id: string; name: string }[];
  members: MemberOption[];
};

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export function BugDetailPanel({ projectId, role, bug, modules, members }: Props) {
  const router = useRouter();
  const canWrite = role !== "VIEWER";
  const canReopenBug = canWrite && REOPENABLE_STATUSES.includes(bug.status);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopening, setReopening] = useState(false);

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingEdit(true);
    const payload = buildBugPayload(event.currentTarget);

    try {
      const response = await fetch(`/api/bugs/${bug.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, moduleName: payload.moduleName ?? null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to update bug.");
        return;
      }
      toast.success("Bug updated.");
      setShowEditDialog(false);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function reopenBug(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReopening(true);
    const formData = new FormData(event.currentTarget);
    const payload = {
      reason: String(formData.get("reason")),
      comment: String(formData.get("comment") ?? "").trim() || undefined,
      environment: String(formData.get("environment") ?? "").trim() || undefined,
      releaseOrBuild: String(formData.get("releaseOrBuild") ?? "").trim() || undefined,
    };

    try {
      const response = await fetch(`/api/bugs/${bug.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to reopen bug.");
        return;
      }
      toast.success("Bug reopened.");
      setShowReopenDialog(false);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/${projectId}/bugs`} className="text-xs text-muted-foreground hover:text-foreground">
          ← Back to bug register
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{bug.displayId}</span>
            <Badge variant={SEVERITY_VARIANT[bug.severity] ?? "outline"}>{bugSeverityLabel(bug.severity)}</Badge>
            {bug.isLeaked && <Badge variant="destructive">Leaked</Badge>}
            {bug.leakageOverridden && <Badge variant="outline">Leakage overridden</Badge>}
            {bug.isRegression && <Badge variant="outline">Regression</Badge>}
          </div>
          <h1 className="mt-1 text-2xl font-semibold">{bug.title}</h1>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[bug.status] ?? "bg-muted-foreground")} />
            {bugStatusLabel(bug.status)}
          </p>
        </div>
        <div className="flex gap-2">
          {canReopenBug && (
            <Button variant="outline" onClick={() => setShowReopenDialog(true)}>
              Reopen
            </Button>
          )}
          {canWrite && <Button onClick={() => setShowEditDialog(true)}>Edit</Button>}
        </div>
      </div>

      {bug.description && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{bug.description}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Classification</h2>
          <InfoRow label="Priority" value={bugPriorityLabel(bug.priority)} />
          <InfoRow label="Bug type" value={bug.bugType ?? "—"} />
          <InfoRow label="Root cause" value={bug.rootCause ? rootCauseLabel(bug.rootCause) : "—"} />
          <InfoRow label="Detection source" value={detectionSourceLabel(bug.detectionSource)} />
          <InfoRow label="Detection phase" value={detectionPhaseLabel(bug.detectionPhase)} />
          <InfoRow label="Environment" value={bug.environment ?? "—"} />
          {bug.leakageOverridden && bug.leakageOverrideReason && (
            <InfoRow label="Leakage override reason" value={bug.leakageOverrideReason} />
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Responsibility</h2>
          <InfoRow label="Assigned developer" value={bug.assignedDeveloper?.name ?? bug.assignedDeveloper?.email ?? "—"} />
          <InfoRow label="Responsible QA" value={bug.responsibleQa?.name ?? bug.responsibleQa?.email ?? "—"} />
          <InfoRow label="Reporter" value={bug.reporter?.name ?? bug.reporter?.email ?? "—"} />
          <InfoRow label="Module" value={bug.module?.name ?? "—"} />
          <InfoRow label="Sprint" value={bug.sprint ?? "—"} />
          <InfoRow label="Release" value={bug.release ?? "—"} />
          <InfoRow label="Fix version" value={bug.fixVersion ?? "—"} />
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Dates</h2>
          <InfoRow label="Created" value={fmtDate(bug.createdAt)} />
          <InfoRow label="First detected" value={fmtDate(bug.firstDetectedDate)} />
          <InfoRow label="First fixed" value={fmtDate(bug.firstFixedDate)} />
          <InfoRow label="Last fixed" value={fmtDate(bug.lastFixedDate)} />
          <InfoRow label="Closed" value={fmtDate(bug.closedDate)} />
          <InfoRow label="First reopened" value={fmtDate(bug.firstReopenedDate)} />
          <InfoRow label="Last reopened" value={fmtDate(bug.lastReopenedDate)} />
          <InfoRow label="Reopen count" value={String(bug.reopenCount)} />
        </div>
      </div>

      {(bug.reproductionSteps || bug.expectedResult || bug.actualResult || bug.clientImpact || bug.businessImpact) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Additional information</h2>
          {bug.reproductionSteps && <InfoRow label="Reproduction steps" value={<span className="whitespace-pre-wrap">{bug.reproductionSteps}</span>} />}
          {bug.expectedResult && <InfoRow label="Expected result" value={bug.expectedResult} />}
          {bug.actualResult && <InfoRow label="Actual result" value={bug.actualResult} />}
          {bug.clientImpact && <InfoRow label="Client impact" value={bug.clientImpact} />}
          {bug.businessImpact && <InfoRow label="Business impact" value={bug.businessImpact} />}
        </div>
      )}

      {/* ── Reopen history ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Reopen history</h2>
        {bug.reopenEvents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">This bug has never been reopened.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Transition</th>
                  <th className="py-2 pr-4">Reopened at</th>
                  <th className="py-2 pr-4">Reopened by</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bug.reopenEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="py-2 pr-4 font-mono">{event.sequenceNumber}</td>
                    <td className="py-2 pr-4">
                      {bugStatusLabel(event.previousStatus)} → {bugStatusLabel(event.newStatus)}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{fmtDate(event.reopenedAt)}</td>
                    <td className="py-2 pr-4">{event.reopenedBy.name ?? event.reopenedBy.email}</td>
                    <td className="py-2 pr-4">{reopenReasonLabel(event.reason)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{event.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Edit dialog ── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>Edit bug {bug.displayId}</DialogTitle>
            <DialogDescription>Update the bug details.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveEdit}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <BugFormFields defaults={bug} modules={modules} members={members} showStatus />
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={savingEdit} className="w-full sm:w-auto">{savingEdit ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Reopen dialog ── */}
      <Dialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen bug {bug.displayId}</DialogTitle>
            <DialogDescription>A reason is required — this creates a new reopen event.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={reopenBug}>
            <div className="space-y-1">
              <Label htmlFor="reopen-reason">Reason *</Label>
              <select
                id="reopen-reason"
                name="reason"
                required
                defaultValue=""
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>Select a reason…</option>
                {REOPEN_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reopen-comment">Comment</Label>
              <textarea
                id="reopen-comment"
                name="comment"
                className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="reopen-environment">Environment</Label>
                <input
                  id="reopen-environment"
                  name="environment"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reopen-releaseOrBuild">Release / build</Label>
                <input
                  id="reopen-releaseOrBuild"
                  name="releaseOrBuild"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setShowReopenDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={reopening}>{reopening ? "Reopening…" : "Reopen bug"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
