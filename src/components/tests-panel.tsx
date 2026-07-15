"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type TestCaseItem = {
  id: string;
  displayId: string;
  title: string;
  priority: string;
  module: string | null;
  status: string;
  description?: string | null;
  preconditions?: string | null;
  expectedResult?: string | null;
  tags?: string[];
  jiraKey?: string | null;
  importBatchId?: string | null;
};

type ImportBatch = {
  id: string;
  filename: string;
  importedAt: string;
  caseCount: number;
};

type JiraRowAnalysis = {
  rowNumber: number;
  original: string;
  corrected: string | null;
  wasChanged: boolean;
};

type JiraAnalysis = {
  needsReview: boolean;
  rows: JiraRowAnalysis[];
  willCorrect: number;
  willSkip: number;
};

type ManualResult = {
  id: string;
  name: string;
  status: "PASSED" | "FAILED" | "SKIPPED" | "ERROR" | "BLOCKED";
};

type ManualRun = {
  id: string;
  name: string;
  status: string;
  results: ManualResult[];
};

type CompletedRun = {
  id: string;
  name: string;
  completedAt: string | null;
  startedAt: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
};

type SuiteCase = {
  id: string;
  testCase: {
    id: string;
    displayId: string;
    title: string;
    priority: string;
    status: string;
    jiraKey: string | null;
    module: { name: string } | null;
  };
};

type TestSuite = {
  id: string;
  name: string;
  description?: string | null;
  cases: SuiteCase[];
};

type Props = {
  projectId: string;
  testCasePrefix: string;
  testCases: TestCaseItem[];
  activeManualRun: ManualRun | null;
  suites: TestSuite[];
  completedRuns: CompletedRun[];
  importBatches?: ImportBatch[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<"PASSED" | "FAILED" | "BLOCKED", string> = {
  PASSED:
    "border-[var(--success)] bg-[oklch(from_var(--success)_l_c_h_/_0.10)] text-[var(--success)] font-semibold",
  FAILED:
    "border-destructive bg-[oklch(from_var(--destructive)_l_c_h_/_0.10)] text-destructive font-semibold",
  BLOCKED:
    "border-[var(--warning)] bg-[oklch(from_var(--warning)_l_c_h_/_0.10)] text-[var(--warning-foreground)] font-semibold",
};

const STATUS_SELECTED_STYLES: Record<"PASSED" | "FAILED" | "BLOCKED", string> = {
  PASSED: "bg-[var(--success)] text-[var(--success-foreground)] border-[var(--success)]",
  FAILED: "bg-destructive text-destructive-foreground border-destructive",
  BLOCKED: "bg-[var(--warning)] text-[var(--warning-foreground)] border-[var(--warning)]",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

const CASE_STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-[var(--success)]",
  DRAFT: "bg-muted-foreground",
  DEPRECATED: "bg-[var(--warning)]",
};

// ─── Redesign helpers (violet/mono palette) ────────────────────────────────────

const PRIORITY_SHORT: Record<string, string> = {
  CRITICAL: "CRIT",
  HIGH: "HIGH",
  MEDIUM: "MED",
  LOW: "LOW",
};

/** Priority pill background/foreground for the redesign palette. */
function prioPillStyle(priority: string): React.CSSProperties {
  switch (priority) {
    case "CRITICAL":
      return { background: "var(--rd-fail-soft)", color: "var(--rd-fail)" };
    case "HIGH":
      return { background: "var(--rd-warn-soft)", color: "var(--rd-warn)" };
    case "MEDIUM":
      return { background: "var(--rd-panel2)", color: "var(--rd-muted)" };
    default:
      return { background: "transparent", color: "var(--rd-faint)" };
  }
}

const RD_STATUS_DOT: Record<string, string> = {
  ACTIVE: "var(--rd-pass)",
  DRAFT: "var(--rd-faint)",
  DEPRECATED: "var(--rd-warn)",
};

/** Small mono priority pill used throughout the redesigned Tests screen. */
function PrioPill({ priority, className = "" }: { priority: string; className?: string }) {
  return (
    <span
      className={cn("rd-mono rounded px-1.5 py-0.5 text-[10px] tracking-[0.06em]", className)}
      style={prioPillStyle(priority)}
    >
      {PRIORITY_SHORT[priority] ?? priority}
    </span>
  );
}

// Shared redesign field styles
const RD_INPUT =
  "h-[34px] w-full rounded-md border border-[var(--rd-border)] bg-[var(--rd-panel)] px-2.5 text-[13px] text-[var(--rd-text)] outline-none focus:border-[var(--rd-border2)]";
const RD_TEXTAREA =
  "w-full rounded-md border border-[var(--rd-border)] bg-[var(--rd-panel)] px-2.5 py-2 text-[13px] text-[var(--rd-text)] outline-none focus:border-[var(--rd-border2)] resize-y";
const RD_SELECT =
  "h-[34px] w-full rounded-md border border-[var(--rd-border)] bg-[var(--rd-panel)] px-2 text-[13px] text-[var(--rd-text)] outline-none focus:border-[var(--rd-border2)]";

// ─── Shared form fields ───────────────────────────────────────────────────────

function CaseFormFields({
  defaults,
  testCasePrefix,
  readOnlyDisplayId,
}: {
  defaults?: Partial<TestCaseItem>;
  testCasePrefix: string;
  readOnlyDisplayId?: string;
}) {
  const prefixPreview = (testCasePrefix || "TC").toUpperCase();
  const [jiraHint, setJiraHint] = useState<{
    type: "corrected" | "invalid";
    original: string;
    corrected?: string;
  } | null>(null);

  function handleJiraBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.target.value.trim();
    if (!raw) { setJiraHint(null); return; }
    const upper = raw.toUpperCase();
    if (/^[A-Z][A-Z0-9]*-[0-9]+$/.test(upper)) {
      if (upper !== raw) {
        setJiraHint({ type: "corrected", original: raw, corrected: upper });
      } else {
        setJiraHint(null);
      }
      return;
    }
    const normalised = upper.replace(/[_\s]/g, "-").replace(/[^A-Z0-9-]/g, "");
    if (normalised.includes("-")) {
      const match = normalised.match(/^([A-Z][A-Z0-9]*)-([0-9]+)$/);
      if (match) {
        setJiraHint({ type: "corrected", original: raw, corrected: `${match[1]}-${match[2]}` });
        return;
      }
    } else {
      const match = normalised.match(/^([A-Z]+)([0-9]+)$/);
      if (match) {
        setJiraHint({ type: "corrected", original: raw, corrected: `${match[1]}-${match[2]}` });
        return;
      }
    }
    setJiraHint({ type: "invalid", original: raw });
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tc-title" className="rd-label">title *</label>
        <input
          id="tc-title"
          name="title"
          type="text"
          required
          placeholder="e.g. User can log in"
          maxLength={200}
          defaultValue={defaults?.title ?? ""}
          className={RD_INPUT}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-module" className="rd-label">module</label>
          <input
            id="tc-module"
            name="module"
            type="text"
            placeholder="e.g. Auth"
            defaultValue={defaults?.module ?? ""}
            className={RD_INPUT}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-jira" className="rd-label">jira ref</label>
          <input
            id="tc-jira"
            name="jiraKey"
            type="text"
            placeholder="ABC-1234"
            defaultValue={defaults?.jiraKey ?? ""}
            onBlur={handleJiraBlur}
            onChange={() => setJiraHint(null)}
            className={cn(RD_INPUT, "rd-mono")}
          />
          {jiraHint?.type === "corrected" && (
            <p className="flex items-center gap-1 text-[11px]" style={{ color: "var(--rd-warn)" }}>
              Will be saved as <span className="rd-mono font-semibold">{jiraHint.corrected}</span>
            </p>
          )}
          {jiraHint?.type === "invalid" && (
            <p className="flex items-center gap-1 text-[11px]" style={{ color: "var(--rd-fail)" }}>
              Invalid format — use PROJECT-123
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tc-description" className="rd-label">test steps</label>
        <textarea
          id="tc-description"
          name="description"
          rows={4}
          placeholder={"1. Navigate to /login\n2. Enter credentials\n3. Submit"}
          defaultValue={defaults?.description ?? ""}
          className={RD_TEXTAREA}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tc-expected-result" className="rd-label">expected result</label>
        <textarea
          id="tc-expected-result"
          name="expectedResult"
          rows={2}
          placeholder="e.g. User is redirected to the dashboard"
          defaultValue={defaults?.expectedResult ?? ""}
          className={RD_TEXTAREA}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tc-preconditions" className="rd-label">preconditions</label>
        <textarea
          id="tc-preconditions"
          name="preconditions"
          rows={2}
          placeholder="e.g. User must be registered"
          defaultValue={defaults?.preconditions ?? ""}
          className={RD_TEXTAREA}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-priority" className="rd-label">priority</label>
          <select id="tc-priority" name="priority" defaultValue={defaults?.priority ?? "MEDIUM"} className={RD_SELECT}>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-status" className="rd-label">status</label>
          <select id="tc-status" name="status" defaultValue={defaults?.status ?? "ACTIVE"} className={RD_SELECT}>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="DEPRECATED">Deprecated</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tc-tags" className="rd-label">tags</label>
          <input
            id="tc-tags"
            name="tags"
            type="text"
            placeholder="smoke, auth"
            defaultValue={(defaults?.tags ?? []).join(", ")}
            className={RD_INPUT}
          />
        </div>
      </div>

      <p className="rd-mono text-[11px] text-[var(--rd-faint)]">
        {readOnlyDisplayId
          ? `Case ID ${readOnlyDisplayId}. ⌘↵ to save, esc to close.`
          : `ID auto-generates like ${prefixPreview}-0001 on save. ⌘↵ to save, esc to close.`}
      </p>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TestsPanel({ projectId, testCasePrefix, testCases, activeManualRun, suites: initialSuites, completedRuns, importBatches: initialImportBatches = [] }: Props) {
  const router = useRouter();

  // ── Create dialog ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"cases" | "suites" | "run" | "history">("cases");

  // ── Create / edit slide-over ─────────────────────────────────────────────────
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [editTarget, setEditTarget] = useState<TestCaseItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Inline delete confirm ────────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Bulk selection ───────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(0);

  // ── Import ───────────────────────────────────────────────────────────────────
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<"select" | "map" | "jira-review">("select");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jiraAnalysis, setJiraAnalysis] = useState<JiraAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Import batch banners ──────────────────────────────────────────────────────
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(initialImportBatches);

  // ── All cases search + filters ────────────────────────────────────────────────
  const [caseSearch, setCaseSearch] = useState("");
  const [caseTagFilter, setCaseTagFilter] = useState<string[]>([]);
  const [showImportedOnly, setShowImportedOnly] = useState(false);

  // ── Manual run ───────────────────────────────────────────────────────────────
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [runCaseSearch, setRunCaseSearch] = useState("");
  const [runCaseTagFilter] = useState<string[]>([]);
  const [runName, setRunName] = useState(`Manual Run ${new Date().toLocaleDateString()}`);
  const [creatingRun, setCreatingRun] = useState(false);
  const [completingRun, setCompletingRun] = useState(false);
  const [updatingResultId, setUpdatingResultId] = useState<string | null>(null);

  // ── Suites ───────────────────────────────────────────────────────────────────
  const [suites, setSuites] = useState<TestSuite[]>(initialSuites);
  const [showCreateSuiteDialog, setShowCreateSuiteDialog] = useState(false);
  const [creatingSuite, setCreatingSuite] = useState(false);
  const [suiteCaseSearch, setSuiteCaseSearch] = useState("");
  const [suiteSelectedCases, setSuiteSelectedCases] = useState<string[]>([]);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [deletingSuiteId, setDeletingSuiteId] = useState<string | null>(null);
  const [manageSuiteTarget, setManageSuiteTarget] = useState<TestSuite | null>(null);
  const [manageSelectedCases, setManageSelectedCases] = useState<string[]>([]);
  const [manageCaseSearch, setManageCaseSearch] = useState("");
  const [updatingSuiteCases, setUpdatingSuiteCases] = useState(false);
  const [suiteCaseTagFilter, setSuiteCaseTagFilter] = useState<string[]>([]);
  const [manageCaseTagFilter, setManageCaseTagFilter] = useState<string[]>([]);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const filteredCases = useMemo(() => {
    let result = testCases;
    if (showImportedOnly) {
      result = result.filter((tc) => tc.importBatchId != null);
    }
    if (caseSearch.trim()) {
      const q = caseSearch.toLowerCase();
      result = result.filter(
        (tc) =>
          tc.title.toLowerCase().includes(q) ||
          tc.displayId.toLowerCase().includes(q) ||
          (tc.module ?? "").toLowerCase().includes(q) ||
          (tc.jiraKey ?? "").toLowerCase().includes(q) ||
          (tc.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (caseTagFilter.length > 0) {
      result = result.filter((tc) =>
        caseTagFilter.some((tag) => (tc.tags ?? []).includes(tag))
      );
    }
    return result;
  }, [testCases, caseSearch, caseTagFilter, showImportedOnly]);

  const filteredRunCases = useMemo(() => {
    let result = testCases;
    if (runCaseSearch.trim()) {
      const q = runCaseSearch.toLowerCase();
      result = result.filter(
        (tc) =>
          tc.title.toLowerCase().includes(q) ||
          tc.displayId.toLowerCase().includes(q) ||
          (tc.module ?? "").toLowerCase().includes(q) ||
          (tc.jiraKey ?? "").toLowerCase().includes(q) ||
          (tc.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (runCaseTagFilter.length > 0) {
      result = result.filter((tc) =>
        runCaseTagFilter.some((tag) => (tc.tags ?? []).includes(tag))
      );
    }
    return result;
  }, [testCases, runCaseSearch, runCaseTagFilter]);

  const distinctTags = useMemo(() => {
    const all = testCases.flatMap((tc) => tc.tags ?? []);
    return [...new Set(all)].sort();
  }, [testCases]);

  const filteredSuiteCases = useMemo(() => {
    let result = testCases;
    if (suiteCaseSearch.trim()) {
      const q = suiteCaseSearch.toLowerCase();
      result = result.filter(
        (tc) =>
          tc.title.toLowerCase().includes(q) ||
          tc.displayId.toLowerCase().includes(q) ||
          (tc.module ?? "").toLowerCase().includes(q) ||
          (tc.jiraKey ?? "").toLowerCase().includes(q) ||
          (tc.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (suiteCaseTagFilter.length > 0) {
      result = result.filter((tc) =>
        suiteCaseTagFilter.some((tag) => (tc.tags ?? []).includes(tag))
      );
    }
    return result;
  }, [testCases, suiteCaseSearch, suiteCaseTagFilter]);

  const filteredManageCases = useMemo(() => {
    let result = testCases;
    if (manageCaseSearch.trim()) {
      const q = manageCaseSearch.toLowerCase();
      result = result.filter(
        (tc) =>
          tc.title.toLowerCase().includes(q) ||
          tc.displayId.toLowerCase().includes(q) ||
          (tc.module ?? "").toLowerCase().includes(q) ||
          (tc.jiraKey ?? "").toLowerCase().includes(q) ||
          (tc.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (manageCaseTagFilter.length > 0) {
      result = result.filter((tc) =>
        manageCaseTagFilter.some((tag) => (tc.tags ?? []).includes(tag))
      );
    }
    return result;
  }, [testCases, manageCaseSearch, manageCaseTagFilter]);

  const pendingResults = useMemo(
    () => activeManualRun?.results.filter((r) => r.status === "BLOCKED") ?? [],
    [activeManualRun]
  );

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function buildCasePayload(form: HTMLFormElement) {
    const formData = new FormData(form);
    const jiraRaw = String(formData.get("jiraKey") ?? "").trim();
    return {
      projectId,
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      preconditions: String(formData.get("preconditions") ?? "").trim() || undefined,
      expectedResult: String(formData.get("expectedResult") ?? "").trim() || undefined,
      moduleName: String(formData.get("module") ?? "").trim() || undefined,
      tags: String(formData.get("tags") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      priority: String(formData.get("priority") ?? "MEDIUM"),
      status: String(formData.get("status") ?? "ACTIVE"),
      jiraKey: jiraRaw ? jiraRaw.toUpperCase() : null,
    };
  }

  // ─── Create test case ────────────────────────────────────────────────────────

  async function createTestCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setCreatingCase(true);

    const payload = buildCasePayload(form);

    const toastId = toast.loading("Saving test case…");

    try {
      const response = await fetch("/api/test-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to create test case.", { id: toastId });
        return;
      }

      toast.success("Test case created.", { id: toastId });
      form.reset();
      setShowCreateDialog(false);
      router.refresh();
    } catch {
      toast.error("Network error — test case not saved.", { id: toastId });
    } finally {
      setCreatingCase(false);
    }
  }

  // ─── Open edit dialog ────────────────────────────────────────────────────────

  async function openEdit(tc: TestCaseItem) {
    setEditTarget(tc);
  }

  // ─── Save edit ───────────────────────────────────────────────────────────────

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);

    const payload = buildCasePayload(event.currentTarget);

    const toastId = toast.loading("Saving changes…");

    try {
      const response = await fetch(`/api/test-cases/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, moduleName: payload.moduleName ?? null }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to update test case.", { id: toastId });
        return;
      }

      toast.success("Test case updated.", { id: toastId });
      setEditTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error.", { id: toastId });
    } finally {
      setSavingEdit(false);
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async function performDelete(tc: TestCaseItem) {
    setDeletingId(tc.id);

    try {
      const response = await fetch(`/api/test-cases/${tc.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to delete test case.");
        return;
      }
      toast.success("Test case deleted.");
      setConfirmDeleteId(null);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setDeletingId(null);
    }
  }

  // ─── Bulk delete ─────────────────────────────────────────────────────────────

  async function confirmBulkDelete() {
    setBulkDeleting(true);
    setBulkDeleteProgress(0);
    const ids = Array.from(selectedIds);
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch(`/api/test-cases/${ids[i]}`, { method: "DELETE" });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      setBulkDeleteProgress(i + 1);
    }
    setBulkDeleting(false);
    setBulkDeleteProgress(0);
    setShowBulkDeleteDialog(false);
    setSelectedIds(new Set());
    if (failed > 0) {
      toast.error(`${failed} case${failed !== 1 ? "s" : ""} could not be deleted.`);
    } else {
      toast.success(`${ids.length} test case${ids.length !== 1 ? "s" : ""} deleted.`);
    }
    router.refresh();
  }

  // ─── Import batch actions ────────────────────────────────────────────────────

  async function dismissBatch(batchId: string) {
    try {
      await fetch(`/api/import-batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      setImportBatches((prev) => prev.filter((b) => b.id !== batchId));
    } catch {
      toast.error("Unable to dismiss banner.");
    }
  }

  async function undoBatch(batchId: string) {
    const toastId = toast.loading("Undoing import…");
    try {
      const res = await fetch(`/api/import-batches/${batchId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to undo import.", { id: toastId });
        return;
      }
      const { deleted } = (await res.json()) as { deleted: number };
      toast.success(`Removed ${deleted} imported test case${deleted !== 1 ? "s" : ""}.`, { id: toastId });
      setImportBatches((prev) => prev.filter((b) => b.id !== batchId));
      router.refresh();
    } catch {
      toast.error("Network error.", { id: toastId });
    }
  }

  function selectBatchCases(batchId: string) {
    const batchCaseIds = new Set(
      testCases.filter((tc) => tc.importBatchId === batchId).map((tc) => tc.id)
    );
    setSelectedIds(batchCaseIds);
  }

  // ─── Import ──────────────────────────────────────────────────────────────────

  async function handleFileSelect() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);

    try {
      let headers: string[] = [];
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "csv") {
        // Parse CSV headers from first line using native browser APIs
        const text = await file.text();
        const firstLine = text.split(/\r?\n/)[0] ?? "";
        headers = firstLine.split(",").map(h => h.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
      }
      if (ext === "xlsx") {
        // Browser cannot read xlsx headers without a library — proceed to map step
        // with empty headers so the server auto-detects columns by name.
        setCsvHeaders([]);
        setColumnMapping({});
        setImportStep("map");
        return;
      }

      if (headers.length > 0) {
        setCsvHeaders(headers);

        // Initial smart mapping
        const initialMapping: Record<string, string> = {};
        const targets = ["title", "description", "module", "priority", "status", "tags", "preconditions", "expectedResult", "jira"];

        targets.forEach(t => {
          const match = headers.find(h =>
            h.toLowerCase().replace(/\s+/g, "").includes(t.toLowerCase()) ||
            t.toLowerCase().includes(h.toLowerCase().replace(/\s+/g, ""))
          );
          if (match) initialMapping[t] = match;
        });

        setColumnMapping(initialMapping);
        setImportStep("map");
      } else {
        toast.error("File seems empty.");
      }
    } catch {
      toast.error("Unable to read file headers.");
    }
  }

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = selectedFile ?? fileInputRef.current?.files?.[0] ?? null;
    if (!file) { toast.error("Please select a file."); return; }

    if (importStep === "select") {
      await handleFileSelect();
      return;
    }

    // xlsx files skip column mapping (server auto-detects); csvHeaders is empty in that case
    const hasMapping = csvHeaders.length > 0;
    if (hasMapping && !columnMapping.title) {
      toast.error("You must map the 'title' column.");
      return;
    }

    // ── Step 2 → 3: run JIRA preview if jira column is mapped ──
    if (importStep === "map" && columnMapping.jira) {
      setImporting(true);
      try {
        const previewData = new FormData();
        previewData.append("file", file);
        previewData.append("projectId", projectId);
        if (hasMapping) previewData.append("mapping", JSON.stringify(columnMapping));

        const previewRes = await fetch("/api/test-cases/import/preview", { method: "POST", body: previewData });
        if (previewRes.ok) {
          const previewBody = await previewRes.json() as { jiraAnalysis: JiraAnalysis };
          if (previewBody.jiraAnalysis.needsReview) {
            setJiraAnalysis(previewBody.jiraAnalysis);
            setImportStep("jira-review");
            setImporting(false);
            return;
          }
        }
      } catch {
        // preview failed — proceed directly to import without the review step
      }
      setImporting(false);
    }

    await doImport(file, hasMapping);
  }

  async function doImport(file: File, hasMapping: boolean) {
    setImporting(true);
    const toastId = toast.loading("Importing…");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      if (hasMapping) formData.append("mapping", JSON.stringify(columnMapping));

      const response = await fetch("/api/test-cases/import", { method: "POST", body: formData });
      const body = await response.json() as { created?: number; errors?: { row: number; error: string }[]; batchId?: string; filename?: string };

      if (!response.ok) {
        toast.error((body as { error?: string }).error ?? "Import failed.", { id: toastId });
        return;
      }

      const errCount = body.errors?.length ?? 0;
      toast.success(
        `Imported ${body.created} test case${body.created !== 1 ? "s" : ""}${errCount ? ` (${errCount} rows skipped)` : ""}.`,
        { id: toastId }
      );

      // Add the new batch to the banners immediately
      if (body.batchId && body.filename && (body.created ?? 0) > 0) {
        setImportBatches((prev) => [
          { id: body.batchId!, filename: body.filename!, importedAt: new Date().toISOString(), caseCount: body.created! },
          ...prev,
        ]);
      }

      setShowImportDialog(false);
      setImportStep("select");
      setCsvHeaders([]);
      setColumnMapping({});
      setSelectedFile(null);
      setJiraAnalysis(null);
      router.refresh();
    } catch {
      toast.error("Network error during import.", { id: toastId });
    } finally {
      setImporting(false);
    }
  }

  // ─── Manual run ──────────────────────────────────────────────────────────────

  async function createManualRun() {
    if (!selectedCases.length) return;
    setCreatingRun(true);
    const toastId = toast.loading("Starting manual run…");

    try {
      const response = await fetch("/api/manual-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: runName || `Manual Run ${new Date().toLocaleString()}`,
          testCaseIds: selectedCases,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to create manual run.", { id: toastId });
        return;
      }

      const { runId } = await response.json() as { runId: string };
      toast.success("Manual run started.", { id: toastId });
      setSelectedCases([]);
      setSelectedSuiteId(null);
      router.push(`/dashboard/${projectId}/tests/run/${runId}`);
    } catch {
      toast.error("Network error — run not started.", { id: toastId });
    } finally {
      setCreatingRun(false);
    }
  }

  async function completeManualRun() {
    if (!activeManualRun) return;
    setCompletingRun(true);

    try {
      const response = await fetch(`/api/manual-runs/${activeManualRun.id}`, { method: "PATCH" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to complete run.");
        return;
      }
      toast.success("Run marked as complete.");
      router.refresh();
    } catch {
      toast.error("Network error — run not completed.");
    } finally {
      setCompletingRun(false);
    }
  }

  async function updateManualResult(resultId: string, status: "PASSED" | "FAILED" | "BLOCKED") {
    if (!activeManualRun) return;
    setUpdatingResultId(resultId);

    try {
      const response = await fetch(
        `/api/manual-runs/${activeManualRun.id}/results/${resultId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to update result.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error — result not updated.");
    } finally {
      setUpdatingResultId(null);
    }
  }

  async function passAllRemaining() {
    if (!activeManualRun || !pendingResults.length) return;
    const toastId = toast.loading(`Passing ${pendingResults.length} remaining…`);

    try {
      await Promise.all(
        pendingResults.map((r) =>
          fetch(`/api/manual-runs/${activeManualRun.id}/results/${r.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "PASSED" }),
          })
        )
      );
      toast.success("All remaining marked as passed.", { id: toastId });
      router.refresh();
    } catch {
      toast.error("Network error — some results may not have updated.", { id: toastId });
    }
  }

  // ─── Suites ──────────────────────────────────────────────────────────────────

  async function createSuite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingSuite(true);
    const formData = new FormData(event.currentTarget);
    const toastId = toast.loading("Creating suite…");

    try {
      const response = await fetch("/api/test-suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: String(formData.get("name") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim() || undefined,
          testCaseIds: suiteSelectedCases,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to create suite.", { id: toastId });
        return;
      }

      const body = await response.json() as { suite: TestSuite };
      toast.success("Test suite created.", { id: toastId });
      setSuites((prev) => [body.suite, ...prev]);
      setSuiteSelectedCases([]);
      setSuiteCaseSearch("");
      setSuiteCaseTagFilter([]);
      setShowCreateSuiteDialog(false);
    } catch {
      toast.error("Network error.", { id: toastId });
    } finally {
      setCreatingSuite(false);
    }
  }

  async function deleteSuite(suiteId: string) {
    setDeletingSuiteId(suiteId);
    try {
      const response = await fetch(`/api/test-suites/${suiteId}`, { method: "DELETE" });
      if (!response.ok) { toast.error("Unable to delete suite."); return; }
      toast.success("Suite deleted.");
      setSuites((prev) => prev.filter((s) => s.id !== suiteId));
    } catch {
      toast.error("Network error.");
    } finally {
      setDeletingSuiteId(null);
    }
  }

  function openManageSuiteDialog(suite: TestSuite) {
    setManageSuiteTarget(suite);
    setManageSelectedCases(suite.cases.map((c) => c.testCase.id));
    setManageCaseSearch("");
  }

  async function saveSuiteMembership(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manageSuiteTarget) return;
    setUpdatingSuiteCases(true);

    const original = new Set(manageSuiteTarget.cases.map((c) => c.testCase.id));
    const desired = new Set(manageSelectedCases);
    const toAdd = Array.from(desired).filter((id) => !original.has(id));
    const toRemove = Array.from(original).filter((id) => !desired.has(id));

    if (!toAdd.length && !toRemove.length) {
      setManageSuiteTarget(null);
      setUpdatingSuiteCases(false);
      return;
    }

    try {
      let updatedSuite: TestSuite | null = manageSuiteTarget;

      if (toAdd.length) {
        const response = await fetch(`/api/test-suites/${manageSuiteTarget.id}/cases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testCaseIds: toAdd }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; suite?: TestSuite };
        if (!response.ok) {
          toast.error(payload.error ?? "Unable to add cases.");
          setUpdatingSuiteCases(false);
          return;
        }
        updatedSuite = payload.suite ?? updatedSuite;
      }

      if (toRemove.length) {
        const response = await fetch(`/api/test-suites/${manageSuiteTarget.id}/cases`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testCaseIds: toRemove }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; suite?: TestSuite };
        if (!response.ok) {
          toast.error(payload.error ?? "Unable to remove cases.");
          setUpdatingSuiteCases(false);
          return;
        }
        updatedSuite = payload.suite ?? updatedSuite;
      }

      if (updatedSuite) {
        setSuites((prev) => prev.map((suite) => (suite.id === updatedSuite!.id ? updatedSuite! : suite)));
      }

      toast.success("Suite updated.");
      setManageSuiteTarget(null);
    } catch {
      toast.error("Network error — suite not updated.");
    } finally {
      setUpdatingSuiteCases(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Slide-over: new / edit test case ── */}
      {(showCreateDialog || editTarget) && (
        <>
          <div
            onClick={() => { setShowCreateDialog(false); setEditTarget(null); }}
            className="fixed inset-0 z-40"
            style={{ background: "var(--rd-scrim)" }}
          />
          <div
            className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l bg-[var(--rd-bg)] text-[var(--rd-text)]"
            style={{ borderColor: "var(--rd-border2)", boxShadow: "-24px 0 64px -24px oklch(0 0 0 / 0.5)" }}
          >
            <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--rd-border)] px-5">
              <div className="flex items-center gap-2.5">
                <span className="rd-mono text-[11px] text-[var(--rd-accent)]">
                  {editTarget ? editTarget.displayId : `${(testCasePrefix || "TC").toUpperCase()}-????`}
                </span>
                <h2 className="text-sm font-semibold">{editTarget ? "Edit test case" : "New test case"}</h2>
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => { setShowCreateDialog(false); setEditTarget(null); }}
                className="rounded p-1 leading-none text-[var(--rd-faint)] transition-colors hover:text-[var(--rd-text)]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form
              key={editTarget?.id ?? "new"}
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={editTarget ? saveEdit : createTestCase}
            >
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                <CaseFormFields
                  defaults={editTarget ?? undefined}
                  testCasePrefix={testCasePrefix}
                  readOnlyDisplayId={editTarget?.displayId}
                />
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--rd-border)] px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => { setShowCreateDialog(false); setEditTarget(null); }}
                  className="h-8 rounded-md border border-[var(--rd-border)] px-3.5 text-[12.5px] font-medium text-[var(--rd-text)] transition-colors hover:border-[var(--rd-border2)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editTarget ? savingEdit : creatingCase}
                  className="h-8 rounded-md bg-[var(--rd-accent)] px-3.5 text-[12.5px] font-semibold text-[var(--rd-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {editTarget
                    ? savingEdit ? "Saving…" : "Save changes"
                    : creatingCase ? "Saving…" : "Create test case"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* ── Bulk delete confirm dialog ── */}
      <Dialog open={showBulkDeleteDialog} onOpenChange={(open) => { if (!open && !bulkDeleting) setShowBulkDeleteDialog(false); }}>
        <DialogContent className="max-w-[min(95vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} test case{selectedIds.size !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This will permanently delete {selectedIds.size} test case{selectedIds.size !== 1 ? "s" : ""}. Historical run data remains untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={bulkDeleting} onClick={() => setShowBulkDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="w-full sm:w-auto" disabled={bulkDeleting} onClick={confirmBulkDelete}>
              {bulkDeleting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deleting {bulkDeleteProgress} of {selectedIds.size}…
                </span>
              ) : `Delete ${selectedIds.size}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import dialog ── */}
      <Dialog open={showImportDialog} onOpenChange={(open) => {
        setShowImportDialog(open);
        if (!open) {
          setImportStep("select");
          setCsvHeaders([]);
          setColumnMapping({});
          setSelectedFile(null);
          setJiraAnalysis(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }
      }}>
        <DialogContent className={`flex max-h-[min(90dvh,48rem)] flex-col gap-0 overflow-hidden p-0 ${importStep === "map" ? "max-w-2xl" : importStep === "jira-review" ? "max-w-xl" : "max-w-lg"}`}>
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>Import test cases</DialogTitle>
            <DialogDescription>
              {importStep === "select"
                ? "Upload an Excel (.xlsx) or CSV file. You will be able to map columns in the next step."
                : importStep === "jira-review"
                ? "Step 3 of 3 — Review JIRA key corrections before importing."
                : "Map your file columns to the internal test case fields."}
            </DialogDescription>
          </DialogHeader>

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleImport}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {importStep === "select" ? (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={handleFileSelect}
                  className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:bg-muted file:text-foreground hover:file:bg-muted/80"
                />
              ) : importStep === "jira-review" && jiraAnalysis ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    We can automatically fix some JIRA keys to match the required format (e.g. AC-03).
                  </p>
                  <div className="rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Row</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Original</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Corrected to</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {jiraAnalysis.rows.map((row) => (
                          <tr key={row.rowNumber}>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.rowNumber}</td>
                            <td className="px-3 py-2 font-mono">{row.original}</td>
                            <td className="px-3 py-2">
                              {row.corrected !== null ? (
                                <span className="flex items-center gap-1.5 text-foreground">
                                  <span className="font-mono">{row.corrected}</span>
                                  <svg className="h-3.5 w-3.5 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50">(will be skipped)</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {jiraAnalysis.willCorrect > 0 && `${jiraAnalysis.willCorrect} will be corrected`}
                    {jiraAnalysis.willCorrect > 0 && jiraAnalysis.willSkip > 0 && " · "}
                    {jiraAnalysis.willSkip > 0 && `${jiraAnalysis.willSkip} will be skipped`}
                  </p>
                </div>
              ) : csvHeaders.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Column names will be read directly from the .xlsx file. Make sure your spreadsheet has a header row with names like <strong>title</strong>, description, module, priority, status, tags, preconditions, expectedResult, and jira.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 py-2 sm:grid-cols-2">
                  {[
                    { id: "title", label: "Title *", required: true },
                    { id: "description", label: "Test Steps" },
                    { id: "module", label: "Module" },
                    { id: "priority", label: "Priority" },
                    { id: "status", label: "Status" },
                    { id: "tags", label: "Tags" },
                    { id: "preconditions", label: "Preconditions" },
                    { id: "expectedResult", label: "Expected Result" },
                    { id: "jira", label: "Jira Reference" },
                  ].map((field) => (
                    <div key={field.id} className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {field.label}
                      </Label>
                      <Select
                        value={columnMapping[field.id] || "none"}
                        onValueChange={(val) => setColumnMapping(prev => ({
                          ...prev,
                          [field.id]: val === "none" ? "" : val
                        }) as Record<string, string>)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">-- Skip --</SelectItem>
                          {csvHeaders.map(h => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowImportDialog(false)}>
                Cancel
              </Button>
              {importStep === "map" && (
                <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => setImportStep("select")}>
                  Back
                </Button>
              )}
              {importStep === "jira-review" && (
                <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => setImportStep("map")}>
                  Back to mapping
                </Button>
              )}
              {importStep === "jira-review" ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={importing}
                  onClick={() => {
                    const file = selectedFile ?? fileInputRef.current?.files?.[0] ?? null;
                    if (file) doImport(file, csvHeaders.length > 0);
                  }}
                >
                  {importing ? "Importing…" : "Apply corrections & import"}
                </Button>
              ) : (
                <Button type="submit" className="w-full sm:w-auto" disabled={importing || (importStep === "select" && !selectedFile)}>
                  {importing ? "Importing…" : importStep === "select" ? "Next" : "Next"}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Create suite dialog ── */}
      <Dialog
        open={showCreateSuiteDialog}
        onOpenChange={(open) => {
          setShowCreateSuiteDialog(open);
          if (!open) { setSuiteSelectedCases([]); setSuiteCaseSearch(""); }
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>New test suite</DialogTitle>
            <DialogDescription>Group test cases into a named suite.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={createSuite}>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-5 px-6 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="suite-name">Suite name *</Label>
                <Input id="suite-name" name="name" required placeholder="e.g. Smoke Tests" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="suite-description">Description</Label>
                <Input id="suite-description" name="description" placeholder="Optional description" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Test cases</Label>
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = filteredSuiteCases.map((tc) => tc.id);
                      const allSelected = allIds.every((id) => suiteSelectedCases.includes(id));
                      if (allSelected) {
                        setSuiteSelectedCases((cur) => cur.filter((id) => !allIds.includes(id)));
                      } else {
                        setSuiteSelectedCases((cur) => [...new Set([...cur, ...allIds])]);
                      }
                    }}
                    className="text-xs text-primary hover:underline underline-offset-4"
                  >
                    {filteredSuiteCases.length > 0 &&
                    filteredSuiteCases.every((tc) => suiteSelectedCases.includes(tc.id))
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                </div>
                <Input
                  type="search"
                  placeholder="Search by title, ID, tag, or Jira…"
                  value={suiteCaseSearch}
                  onChange={(e) => setSuiteCaseSearch(e.target.value)}
                />
                {distinctTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {distinctTags.map((tag) => {
                      const active = suiteCaseTagFilter.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setSuiteCaseTagFilter((cur) =>
                              active ? cur.filter((t) => t !== tag) : [...cur, tag]
                            )
                          }
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                    {(suiteCaseSearch || suiteCaseTagFilter.length > 0) && (
                      <button
                        type="button"
                        onClick={() => { setSuiteCaseSearch(""); setSuiteCaseTagFilter([]); }}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
                <div className="rounded-lg border border-border">
                  <div className="space-y-0.5 p-2">
                    {filteredSuiteCases.map((tc) => {
                      const selected = suiteSelectedCases.includes(tc.id);
                      return (
                        <label
                          key={tc.id}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={selected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSuiteSelectedCases((cur) => [...cur, tc.id]);
                              } else {
                                setSuiteSelectedCases((cur) => cur.filter((id) => id !== tc.id));
                              }
                            }}
                          />
                          <span className="flex-1 truncate">{tc.title}</span>
                          {tc.module && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {tc.module}
                            </span>
                          )}
                        </label>
                      );
                    })}
                    {filteredSuiteCases.length === 0 && (
                      <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {suiteSelectedCases.length} case{suiteSelectedCases.length !== 1 ? "s" : ""} selected
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowCreateSuiteDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={creatingSuite}>
                {creatingSuite ? "Creating…" : "Create suite"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Manage suite dialog ── */}
      <Dialog
        open={!!manageSuiteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setManageSuiteTarget(null);
            setManageSelectedCases([]);
            setManageCaseSearch("");
            setManageCaseTagFilter([]);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>Manage cases</DialogTitle>
            <DialogDescription>
              Add or remove test cases in &ldquo;{manageSuiteTarget?.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveSuiteMembership}>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-4 px-6 py-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span />
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = filteredManageCases.map((tc) => tc.id);
                      const allSelected = allIds.every((id) => manageSelectedCases.includes(id));
                      if (allSelected) {
                        setManageSelectedCases((cur) => cur.filter((id) => !allIds.includes(id)));
                      } else {
                        setManageSelectedCases((cur) => [...new Set([...cur, ...allIds])]);
                      }
                    }}
                    className="text-xs text-primary hover:underline underline-offset-4"
                  >
                    {filteredManageCases.length > 0 &&
                    filteredManageCases.every((tc) => manageSelectedCases.includes(tc.id))
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                </div>
                <Input
                  type="search"
                  placeholder="Search by title, ID, tag, or Jira…"
                  value={manageCaseSearch}
                  onChange={(e) => setManageCaseSearch(e.target.value)}
                />
                {distinctTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {distinctTags.map((tag) => {
                      const active = manageCaseTagFilter.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setManageCaseTagFilter((cur) =>
                              active ? cur.filter((t) => t !== tag) : [...cur, tag]
                            )
                          }
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                    {(manageCaseSearch || manageCaseTagFilter.length > 0) && (
                      <button
                        type="button"
                        onClick={() => { setManageCaseSearch(""); setManageCaseTagFilter([]); }}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border">
                <div className="space-y-0.5 p-2">
                  {filteredManageCases.map((tc) => {
                    const selected = manageSelectedCases.includes(tc.id);
                    return (
                      <label
                        key={tc.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setManageSelectedCases((cur) => [...cur, tc.id]);
                            } else {
                              setManageSelectedCases((cur) => cur.filter((id) => id !== tc.id));
                            }
                          }}
                        />
                        <div className="flex-1">
                          <p className="truncate text-sm">{tc.title}</p>
                          <p className="text-xs text-muted-foreground">{tc.displayId}</p>
                        </div>
                        <Badge variant={PRIORITY_VARIANT[tc.priority] ?? "outline"} className="text-[10px]">
                          {tc.priority}
                        </Badge>
                      </label>
                    );
                  })}
                  {filteredManageCases.length === 0 && (
                    <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {manageSelectedCases.length} case{manageSelectedCases.length !== 1 ? "s" : ""} selected
              </p>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setManageSuiteTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={updatingSuiteCases}>
                {updatingSuiteCases ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Sticky header ── */}
      <header
        className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[var(--rd-border)] bg-[var(--rd-bg)] px-6"
      >
        <p className="rd-mono text-[12px] text-[var(--rd-muted)]">
          <span className="text-[var(--rd-faint)]">{(testCasePrefix || "TC").toLowerCase()} /</span> tests
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportDialog(true)}
            className="h-[30px] rounded-md border border-[var(--rd-border)] bg-[var(--rd-panel)] px-3 text-[12.5px] font-medium text-[var(--rd-text)] transition-colors hover:border-[var(--rd-border2)]"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-[var(--rd-accent)] px-3 text-[12.5px] font-semibold text-[var(--rd-on-accent)] transition-opacity hover:opacity-90"
          >
            <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New test case
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Test cases</h1>
          <p className="mt-0.5 text-[13px] text-[var(--rd-muted)]">
            {testCases.length} case{testCases.length !== 1 ? "s" : ""} · {suites.length} suite{suites.length !== 1 ? "s" : ""} · {completedRuns.length} completed run{completedRuns.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 border-b border-[var(--rd-border)]">
          {([
            { id: "cases", label: "cases", count: testCases.length },
            { id: "suites", label: "suites", count: suites.length },
            { id: "run", label: "manual-run", dot: !!activeManualRun },
            { id: "history", label: "history", count: completedRuns.length },
          ] as const).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="rd-mono inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] transition-colors"
                style={{
                  color: active ? "var(--rd-text)" : "var(--rd-muted)",
                  boxShadow: active ? "inset 0 -2px 0 var(--rd-accent)" : "none",
                }}
              >
                {tab.label}
                {"count" in tab && tab.count != null && (
                  <span className="text-[10px] text-[var(--rd-faint)]">{tab.count}</span>
                )}
                {"dot" in tab && tab.dot && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--rd-warn)" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Cases tab ── */}
        {activeTab === "cases" && (
          <div className="flex flex-col gap-3">
            {/* Filter row */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-[280px] items-center gap-2 rounded-md border border-[var(--rd-border)] bg-[var(--rd-panel)] px-2.5 py-1.5">
                <svg className="h-[13px] w-[13px] text-[var(--rd-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  placeholder="Filter by title, ID, tag, jira…"
                  className="flex-1 border-none bg-transparent p-0 text-[12.5px] text-[var(--rd-text)] outline-none"
                />
              </div>
              {distinctTags.map((tag) => {
                const on = caseTagFilter.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setCaseTagFilter((cur) => (on ? cur.filter((t) => t !== tag) : [...cur, tag]))
                    }
                    className="rd-mono rounded-full px-2.5 py-[3px] text-[11px] transition-colors"
                    style={{
                      border: `1px solid ${on ? "var(--rd-accent)" : "var(--rd-border)"}`,
                      background: on ? "var(--rd-accent-soft)" : "transparent",
                      color: on ? "var(--rd-accent)" : "var(--rd-muted)",
                    }}
                  >
                    #{tag}
                  </button>
                );
              })}
              {testCases.some((tc) => tc.importBatchId) && (
                <button
                  type="button"
                  onClick={() => setShowImportedOnly((v) => !v)}
                  className="rd-mono rounded-full px-2.5 py-[3px] text-[11px] transition-colors"
                  style={{
                    border: `1px solid ${showImportedOnly ? "var(--rd-warn)" : "var(--rd-border)"}`,
                    background: showImportedOnly ? "var(--rd-warn-soft)" : "transparent",
                    color: showImportedOnly ? "var(--rd-warn)" : "var(--rd-muted)",
                  }}
                >
                  imported
                </button>
              )}
              {(caseSearch || caseTagFilter.length > 0 || showImportedOnly) && (
                <button
                  type="button"
                  onClick={() => { setCaseSearch(""); setCaseTagFilter([]); setShowImportedOnly(false); }}
                  className="rd-mono text-[11px] text-[var(--rd-faint)] underline underline-offset-2 hover:text-[var(--rd-text)]"
                >
                  clear
                </button>
              )}
              {selectedIds.size > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="rd-mono text-[11px] text-[var(--rd-muted)]">{selectedIds.size} selected</span>
                  <button
                    type="button"
                    onClick={() => setShowBulkDeleteDialog(true)}
                    className="rd-mono rounded-md px-2.5 py-1 text-[11px] font-medium text-[oklch(0.99_0_0)]"
                    style={{ background: "var(--rd-fail)" }}
                  >
                    delete selected
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    title="Clear selection"
                    className="rounded p-0.5 text-[var(--rd-faint)] hover:text-[var(--rd-text)]"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Import banners */}
            {importBatches.map((batch) => (
              <div
                key={batch.id}
                className="flex items-center gap-3 rounded-[7px] px-3.5 py-2"
                style={{ border: "1px solid var(--rd-warn)", background: "var(--rd-warn-soft)" }}
              >
                <span className="rd-mono text-[11px]" style={{ color: "var(--rd-warn)" }}>IMPORT</span>
                <span className="flex-1 text-[12.5px] text-[var(--rd-text)]">
                  <strong>{batch.caseCount} case{batch.caseCount !== 1 ? "s" : ""}</strong> from {batch.filename}
                </span>
                <button type="button" onClick={() => undoBatch(batch.id)} className="rd-mono text-[11px] underline underline-offset-[3px]" style={{ color: "var(--rd-warn)" }}>undo</button>
                <button type="button" onClick={() => selectBatchCases(batch.id)} className="rd-mono text-[11px] underline underline-offset-[3px]" style={{ color: "var(--rd-warn)" }}>select</button>
                <button type="button" onClick={() => dismissBatch(batch.id)} title="Dismiss" className="p-0.5 leading-none" style={{ color: "var(--rd-warn)" }}>
                  <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Table / empty */}
            {filteredCases.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--rd-border)] bg-[var(--rd-panel)] p-10 text-center">
                {testCases.length === 0 ? (
                  <>
                    <p className="text-[13px] font-medium">No test cases yet</p>
                    <p className="mt-1 text-[13px] text-[var(--rd-muted)]">Create your first test case or import from a file.</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button type="button" onClick={() => setShowImportDialog(true)} className="h-8 rounded-md border border-[var(--rd-border)] px-3 text-[12.5px] font-medium hover:border-[var(--rd-border2)]">Import</button>
                      <button type="button" onClick={() => setShowCreateDialog(true)} className="h-8 rounded-md px-3 text-[12.5px] font-semibold text-[var(--rd-on-accent)]" style={{ background: "var(--rd-accent)" }}>New test case</button>
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-[var(--rd-muted)]">No test cases match your search.</p>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[var(--rd-border)] bg-[var(--rd-panel)]">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="w-9 border-b border-[var(--rd-border)] px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={filteredCases.length > 0 && filteredCases.every((tc) => selectedIds.has(tc.id))}
                          onChange={(e) =>
                            setSelectedIds(e.target.checked ? new Set(filteredCases.map((tc) => tc.id)) : new Set())
                          }
                        />
                      </th>
                      {["id", "title", "module", "jira", "priority", "status"].map((h) => (
                        <th key={h} className="rd-mono border-b border-[var(--rd-border)] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--rd-faint)]">{h}</th>
                      ))}
                      <th className="w-[130px] border-b border-[var(--rd-border)] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCases.map((tc) => {
                      const confirming = confirmDeleteId === tc.id;
                      return (
                        <tr
                          key={tc.id}
                          className="transition-colors hover:bg-[var(--rd-panel2)]"
                          style={{ boxShadow: tc.importBatchId ? "inset 2px 0 0 var(--rd-warn)" : "none" }}
                        >
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${tc.displayId}`}
                              checked={selectedIds.has(tc.id)}
                              onChange={(e) => {
                                const next = new Set(selectedIds);
                                if (e.target.checked) next.add(tc.id); else next.delete(tc.id);
                                setSelectedIds(next);
                              }}
                            />
                          </td>
                          <td className="rd-mono whitespace-nowrap border-b border-[var(--rd-border)] px-3 py-2.5 text-[12px]" style={{ color: "var(--rd-accent)" }}>{tc.displayId}</td>
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{tc.title}</span>
                              {tc.importBatchId && (
                                <span className="rd-mono rounded-[3px] px-1.5 py-px text-[9px] tracking-[0.08em]" style={{ background: "var(--rd-warn-soft)", color: "var(--rd-warn)" }}>IMPORTED</span>
                              )}
                            </div>
                          </td>
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5">
                            <span className="rd-mono text-[11px] text-[var(--rd-muted)]">{tc.module ?? "—"}</span>
                          </td>
                          <td className="rd-mono border-b border-[var(--rd-border)] px-3 py-2.5 text-[11px] text-[var(--rd-muted)]">{tc.jiraKey ?? "—"}</td>
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5"><PrioPill priority={tc.priority} /></td>
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: RD_STATUS_DOT[tc.status] ?? "var(--rd-faint)" }} />
                              <span className="text-[12px] capitalize text-[var(--rd-muted)]">{tc.status.toLowerCase()}</span>
                            </span>
                          </td>
                          <td className="border-b border-[var(--rd-border)] px-3 py-2.5 text-right">
                            {confirming ? (
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                <button
                                  type="button"
                                  disabled={deletingId === tc.id}
                                  onClick={() => performDelete(tc)}
                                  className="rd-mono rounded px-2 py-[3px] text-[10px] text-[oklch(0.99_0_0)] disabled:opacity-60"
                                  style={{ background: "var(--rd-fail)" }}
                                >
                                  {deletingId === tc.id ? "…" : "sure?"}
                                </button>
                                <button type="button" onClick={() => setConfirmDeleteId(null)} className="rd-mono text-[10px] text-[var(--rd-muted)]">esc</button>
                              </span>
                            ) : (
                              <span className="inline-flex gap-0.5">
                                <button type="button" title="Edit" onClick={() => openEdit(tc)} className="rounded p-1 leading-none text-[var(--rd-faint)] transition-colors hover:bg-[var(--rd-panel2)] hover:text-[var(--rd-text)]">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button type="button" title="Delete" onClick={() => setConfirmDeleteId(tc.id)} className="rounded p-1 leading-none text-[var(--rd-faint)] transition-colors hover:bg-[var(--rd-fail-soft)] hover:text-[var(--rd-fail)]">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Suites tab ── */}
        {activeTab === "suites" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowCreateSuiteDialog(true)}
                disabled={testCases.length === 0}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold text-[var(--rd-on-accent)] disabled:opacity-50"
                style={{ background: "var(--rd-accent)" }}
              >
                <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New suite
              </button>
            </div>
            {suites.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--rd-border)] bg-[var(--rd-panel)] p-10 text-center">
                <p className="text-[13px] font-medium">No test suites yet</p>
                <p className="mt-1 text-[13px] text-[var(--rd-muted)]">Group test cases together into suites for organised runs.</p>
              </div>
            ) : (
              suites.map((suite) => {
                const expanded = expandedSuite === suite.id;
                return (
                  <div key={suite.id} className="overflow-hidden rounded-lg border border-[var(--rd-border)] bg-[var(--rd-panel)]">
                    <div
                      onClick={() => setExpandedSuite(expanded ? null : suite.id)}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--rd-panel2)]"
                    >
                      <svg
                        className="h-3.5 w-3.5 text-[var(--rd-faint)] transition-transform"
                        style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-[13.5px] font-semibold">{suite.name}</p>
                        {suite.description && <p className="mt-px text-[12px] text-[var(--rd-muted)]">{suite.description}</p>}
                      </div>
                      <span className="rd-mono text-[11px] text-[var(--rd-faint)]">{suite.cases.length} case{suite.cases.length !== 1 ? "s" : ""}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openManageSuiteDialog(suite); }}
                        className="h-[26px] rounded-[5px] border border-[var(--rd-border)] px-2.5 text-[12px] font-medium transition-colors hover:border-[var(--rd-border2)]"
                      >
                        Manage
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteSuite(suite.id); }}
                        disabled={deletingSuiteId === suite.id}
                        title="Delete suite"
                        className="rounded p-1 leading-none text-[var(--rd-faint)] transition-colors hover:bg-[var(--rd-fail-soft)] hover:text-[var(--rd-fail)]"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t border-[var(--rd-border)]">
                        {suite.cases.length === 0 ? (
                          <p className="px-4 py-3 text-[13px] text-[var(--rd-muted)]">No cases in this suite.</p>
                        ) : (
                          suite.cases.map((sc) => (
                            <div key={sc.id} className="flex items-center gap-3 border-b border-[var(--rd-border)] py-2.5 pl-[42px] pr-4">
                              <span className="rd-mono text-[11px]" style={{ color: "var(--rd-accent)" }}>{sc.testCase.displayId}</span>
                              <span className="flex-1 text-[13px]">{sc.testCase.title}</span>
                              {sc.testCase.module && <span className="rd-mono text-[11px] text-[var(--rd-muted)]">{sc.testCase.module.name}</span>}
                              <PrioPill priority={sc.testCase.priority} />
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Manual run tab ── */}
        {activeTab === "run" && (
          <div className="flex max-w-[720px] flex-col gap-5">
            {activeManualRun && (
              <div className="flex items-center gap-4 rounded-lg px-4 py-3.5" style={{ border: "1px solid var(--rd-warn)", background: "var(--rd-warn-soft)" }}>
                <span className="rd-mono text-[10px] tracking-[0.1em]" style={{ color: "var(--rd-warn)" }}>ACTIVE RUN</span>
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold">{activeManualRun.name}</p>
                  <p className="rd-mono mt-px text-[11px] text-[var(--rd-muted)]">
                    {activeManualRun.results.filter((r) => r.status !== "BLOCKED").length} / {activeManualRun.results.length} tested
                  </p>
                </div>
                <a
                  href={`/dashboard/${projectId}/tests/run/${activeManualRun.id}`}
                  className="inline-flex h-[30px] items-center rounded-md px-3 text-[12.5px] font-semibold text-[var(--rd-on-accent)]"
                  style={{ background: "var(--rd-accent)" }}
                >
                  Continue →
                </a>
              </div>
            )}
            <div className="flex flex-col gap-3.5 rounded-lg border border-[var(--rd-border)] bg-[var(--rd-panel)] p-4.5" style={{ padding: "18px" }}>
              <h3 className="text-[13.5px] font-semibold">Start a new run</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="rd-label">from suite</label>
                  <select
                    className={RD_SELECT}
                    value={selectedSuiteId ?? "none"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "none") { setSelectedSuiteId(null); setSelectedCases([]); }
                      else {
                        setSelectedSuiteId(val);
                        const s = suites.find((x) => x.id === val);
                        if (s) setSelectedCases(s.cases.map((c) => c.testCase.id));
                      }
                    }}
                  >
                    <option value="none">— none —</option>
                    {suites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.cases.length})</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="rd-label">run name</label>
                  <input value={runName} onChange={(e) => setRunName(e.target.value)} className={RD_INPUT} />
                </div>
              </div>
              {testCases.length > 0 && (
                <input
                  value={runCaseSearch}
                  onChange={(e) => setRunCaseSearch(e.target.value)}
                  placeholder="Filter cases…"
                  className={RD_INPUT}
                />
              )}
              <div className="max-h-[220px] overflow-auto rounded-md border border-[var(--rd-border)]">
                {filteredRunCases.length === 0 ? (
                  <p className="px-3 py-3 text-[13px] text-[var(--rd-muted)]">{testCases.length === 0 ? "No test cases yet." : "No matches."}</p>
                ) : (
                  filteredRunCases.map((tc) => {
                    const on = selectedCases.includes(tc.id);
                    return (
                      <label key={tc.id} className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--rd-border)] px-3 py-2 text-[13px] transition-colors hover:bg-[var(--rd-panel2)]">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setSelectedCases((cur) => (e.target.checked ? [...cur, tc.id] : cur.filter((id) => id !== tc.id)))
                          }
                        />
                        <span className="rd-mono text-[11px]" style={{ color: "var(--rd-accent)" }}>{tc.displayId}</span>
                        <span className="flex-1 truncate">{tc.title}</span>
                        <PrioPill priority={tc.priority} />
                      </label>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="rd-mono text-[11px] text-[var(--rd-muted)]">{selectedCases.length} selected</span>
                <button
                  type="button"
                  disabled={!selectedCases.length || creatingRun}
                  onClick={createManualRun}
                  className="h-8 rounded-md px-3.5 text-[12.5px] font-semibold text-[var(--rd-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "var(--rd-accent)" }}
                >
                  {creatingRun ? "Starting…" : "Start manual run"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── History tab ── */}
        {activeTab === "history" && (
          completedRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--rd-border)] bg-[var(--rd-panel)] p-10 text-center">
              <p className="text-[13px] font-medium">No completed runs yet</p>
              <p className="mt-1 text-[13px] text-[var(--rd-muted)]">Completed manual runs will appear here with links to their reports.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--rd-border)] bg-[var(--rd-panel)]">
              {completedRuns.map((run) => {
                const total = run.total || 1;
                const passW = `${Math.round((run.passed / total) * 100)}%`;
                const failW = `${Math.round((run.failed / total) * 100)}%`;
                const date = run.completedAt
                  ? new Date(run.completedAt).toLocaleString()
                  : new Date(run.startedAt).toLocaleString();
                return (
                  <div key={run.id} className="flex items-center gap-4 border-b border-[var(--rd-border)] px-4 py-3 transition-colors hover:bg-[var(--rd-panel2)]">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{run.name}</p>
                      <p className="rd-mono mt-px text-[11px] text-[var(--rd-faint)]">{date}</p>
                    </div>
                    <div className="flex h-1 w-[120px] overflow-hidden rounded-sm" style={{ background: "var(--rd-panel2)" }}>
                      <div style={{ width: passW, background: "var(--rd-pass)" }} />
                      <div style={{ width: failW, background: "var(--rd-fail)" }} />
                    </div>
                    <span className="rd-mono w-[72px] text-right text-[11px]" style={{ color: "var(--rd-pass)" }}>{run.passed} pass</span>
                    <span className="rd-mono w-[56px] text-right text-[11px]" style={{ color: run.failed > 0 ? "var(--rd-fail)" : "var(--rd-faint)" }}>{run.failed} fail</span>
                    <a href={`/report/runs/${run.id}`} className="rd-mono text-[11px]" style={{ color: "var(--rd-accent)" }}>report →</a>
                  </div>
                );
              })}
            </div>
          )
        )}
      </main>
    </>
  );
}
