"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunResult = {
  id: string;
  name: string;
  status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR" | "BLOCKED";
  notes: string | null;
  testCase: {
    displayId: string;
    title: string;
    description: string | null;
    preconditions: string | null;
    expectedResult: string | null;
    priority: string;
    module: { name: string } | null;
  } | null;
};

type Run = {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  results: RunResult[];
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ActiveRunPanel({ run: initialRun, testsUrl = "/dashboard" }: { run: Run; testsUrl?: string }) {
  const router = useRouter();
  const [results, setResults] = useState<RunResult[]>(initialRun.results);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(initialRun.results.map((r) => [r.id, r.notes ?? ""]))
  );

  const tested = results.filter((r) => r.status !== "BLOCKED").length;
  const total = results.length;
  const progress = total > 0 ? Math.round((tested / total) * 100) : 0;
  const allTested = tested === total;

  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  const pending = results.filter((r) => r.status === "BLOCKED").length;

  // Shared by updateStatus and saveNotes so both paths get the same
  // ok-check, error surfacing, and network-failure handling. Returns
  // whether the PATCH actually succeeded so callers only update local
  // state (and thus what the tester sees) when the server confirms it.
  async function patchResult(resultId: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/manual-runs/${initialRun.id}/results/${resultId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Failed to save your change. Please try again.");
        return false;
      }
      return true;
    } catch {
      toast.error("Network error — your change was not saved.");
      return false;
    }
  }

  async function updateStatus(resultId: string, status: "PASSED" | "FAILED" | "SKIPPED") {
    setUpdatingId(resultId);
    const ok = await patchResult(resultId, { status });
    if (ok) {
      setResults((prev) => prev.map((r) => (r.id === resultId ? { ...r, status } : r)));
    }
    setUpdatingId(null);
  }

  async function saveNotes(resultId: string) {
    const result = results.find((r) => r.id === resultId);
    if (!result || result.status === "BLOCKED") return;
    const noteText = notes[resultId] ?? "";
    // Intentionally omits `status` — sending the status captured at render
    // time here could race a concurrent updateStatus() call and revert the
    // result the tester just set. Notes and status are saved independently.
    const ok = await patchResult(resultId, { notes: noteText });
    if (ok) {
      setResults((prev) => prev.map((r) => (r.id === resultId ? { ...r, notes: noteText } : r)));
    }
  }

  async function completeRun() {
    setCompleting(true);
    try {
      const res = await fetch(`/api/manual-runs/${initialRun.id}`, { method: "PATCH" });
      if (!res.ok) {
        toast.error("Failed to complete the run. Please try again.");
        return;
      }
      router.push(`/report/runs/${initialRun.id}`);
    } catch {
      toast.error("Network error — the run was not completed.");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* ── Header ── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(testsUrl)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Tests
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active run</p>
            <h1 className="text-2xl font-semibold mt-0.5">{initialRun.name}</h1>
          </div>
        </div>
        <Button onClick={completeRun} disabled={completing} variant={allTested ? "default" : "outline"}>
          {completing ? "Completing…" : "Complete run"}
        </Button>
      </div>

      {/* ── Progress ── */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <div className="flex justify-between text-sm mb-3">
          <span className="text-muted-foreground font-medium">{tested} of {total} tested</span>
          <span className="font-bold tabular-nums">{progress}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-[var(--success)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
            {passed} passed
          </span>
          <span className="flex items-center gap-1.5 text-destructive">
            <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
            {failed} failed
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
            {skipped} skipped
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground/60">
            <span className="inline-block h-2 w-2 rounded-full border border-muted-foreground/40" />
            {pending} pending
          </span>
        </div>
      </div>

      {/* ── Test case cards ── */}
      <div className="space-y-4">
        {results.map((result) => {
          const isPending = result.status === "BLOCKED";
          const isFailed = result.status === "FAILED";
          const isPassed = result.status === "PASSED";

          return (
            <div
              key={result.id}
              className={`rounded-xl border overflow-hidden transition-colors ${
                isFailed
                  ? "border-destructive/50 bg-destructive/5"
                  : isPassed
                  ? "border-[var(--success)]/40 bg-[oklch(from_var(--success)_l_c_h_/_0.04)]"
                  : isPending
                  ? "border-border bg-card"
                  : "border-muted bg-muted/20"
              }`}
            >
              <div className="p-5">
                {/* Card header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {result.testCase?.displayId ?? "—"}
                      </span>
                      {result.testCase?.module && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {result.testCase.module.name}
                        </span>
                      )}
                      <Badge
                        variant={PRIORITY_VARIANT[result.testCase?.priority ?? ""] ?? "outline"}
                        className="text-[10px] px-1.5"
                      >
                        {result.testCase?.priority}
                      </Badge>
                    </div>
                    <p className="font-semibold leading-snug">{result.testCase?.title ?? result.name}</p>
                  </div>
                  {!isPending && (
                    <span
                      className={`shrink-0 text-xs font-bold uppercase tracking-wider ${
                        isPassed
                          ? "text-[var(--success)]"
                          : isFailed
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {result.status === "SKIPPED" ? "SKIP" : result.status}
                    </span>
                  )}
                </div>

                {/* Preconditions */}
                {result.testCase?.preconditions && (
                  <div className="mb-3 rounded-lg bg-muted/60 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      Preconditions
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {result.testCase.preconditions}
                    </p>
                  </div>
                )}

                {/* Test steps */}
                {result.testCase?.description && (
                  <div className="mb-3 rounded-lg border border-border/60 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      Test steps
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {result.testCase.description}
                    </p>
                  </div>
                )}

                {/* Expected result */}
                {result.testCase?.expectedResult && (
                  <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      Expected result
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {result.testCase.expectedResult}
                    </p>
                  </div>
                )}

                {/* Status buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(["PASSED", "FAILED", "SKIPPED"] as const).map((status) => {
                    const isSelected = result.status === status;
                    const label = status === "SKIPPED" ? "SKIP" : status;
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={updatingId === result.id}
                        onClick={() => updateStatus(result.id, status)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          isSelected
                            ? status === "PASSED"
                              ? "bg-[var(--success)] text-[var(--success-foreground)] border-[var(--success)]"
                              : status === "FAILED"
                              ? "bg-destructive text-destructive-foreground border-destructive"
                              : "bg-muted text-foreground border-input"
                            : status === "PASSED"
                            ? "border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)] hover:text-[var(--success-foreground)]"
                            : status === "FAILED"
                            ? "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            : "border-input text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Actual result notes (only for failed) */}
                {isFailed && (
                  <div className="mt-3">
                    <label
                      htmlFor={`notes-${result.id}`}
                      className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                    >
                      Actual result
                    </label>
                    <textarea
                      id={`notes-${result.id}`}
                      value={notes[result.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [result.id]: e.target.value }))}
                      onBlur={() => saveNotes(result.id)}
                      placeholder="Describe what actually happened…"
                      rows={2}
                      className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Bottom complete button ── */}
      <div className="mt-10 flex justify-end">
        <Button onClick={completeRun} disabled={completing} size="lg" variant={allTested ? "default" : "outline"}>
          {completing ? "Completing…" : allTested ? "Complete & view report" : "Complete run"}
        </Button>
      </div>
    </div>
  );
}
