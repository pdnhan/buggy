"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

// ─── Shared form fields ───────────────────────────────────────────────────────

function CaseFormFields({
  showAdvanced,
  setShowAdvanced,
  defaults,
  testCasePrefix,
  readOnlyDisplayId,
}: {
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  defaults?: Partial<TestCaseItem>;
  testCasePrefix: string;
  readOnlyDisplayId?: string;
}) {
  const prefixPreview = (testCasePrefix || "TC").toUpperCase();
  const idHint = `${prefixPreview}-0001`;
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
      <div className="space-y-1">
        <Label htmlFor="tc-title">Title *</Label>
        <Input
          id="tc-title"
          name="title"
          type="text"
          required
          placeholder="e.g. User can log in"
          maxLength={200}
          defaultValue={defaults?.title ?? ""}
        />
        <p className="text-xs text-muted-foreground">IDs auto-generate like {idHint} when saved.</p>
      </div>

      {readOnlyDisplayId && (
        <div className="space-y-1">
          <Label>Case ID</Label>
          <Input value={readOnlyDisplayId} readOnly disabled />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="tc-module">Module</Label>
          <Input
            id="tc-module"
            name="module"
            type="text"
            placeholder="e.g. Auth"
            defaultValue={defaults?.module ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tc-jira">Jira reference</Label>
          <Input
            id="tc-jira"
            name="jiraKey"
            type="text"
            placeholder="ABC-1234"
            defaultValue={defaults?.jiraKey ?? ""}
            onBlur={handleJiraBlur}
            onChange={() => setJiraHint(null)}
          />
          {jiraHint?.type === "corrected" && (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Will be saved as <span className="font-mono font-semibold">{jiraHint.corrected}</span>
            </p>
          )}
          {jiraHint?.type === "invalid" && (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Invalid format — use PROJECT-123
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="tc-description">Test steps</Label>
        <textarea
          id="tc-description"
          name="description"
          placeholder="Step-by-step test instructions"
          defaultValue={defaults?.description ?? ""}
          className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="tc-expected-result">Expected result</Label>
        <textarea
          id="tc-expected-result"
          name="expectedResult"
          placeholder="e.g. User is redirected to the dashboard"
          defaultValue={defaults?.expectedResult ?? ""}
          className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="tc-preconditions">Preconditions</Label>
        <textarea
          id="tc-preconditions"
          name="preconditions"
          placeholder="e.g. User must be registered"
          defaultValue={defaults?.preconditions ?? ""}
          className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="tc-tags">Tags</Label>
        <Input
          id="tc-tags"
          name="tags"
          type="text"
          placeholder="smoke, regression"
          defaultValue={(defaults?.tags ?? []).join(", ")}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {showAdvanced ? "Hide advanced options" : "Advanced options"}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tc-priority">Priority</Label>
              <select
                id="tc-priority"
                name="priority"
                defaultValue={defaults?.priority ?? "MEDIUM"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tc-status">Status</Label>
              <select
                id="tc-status"
                name="status"
                defaultValue={defaults?.status ?? "ACTIVE"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TestsPanel({ projectId, testCasePrefix, testCases, activeManualRun, suites: initialSuites, completedRuns, importBatches: initialImportBatches = [] }: Props) {
  const router = useRouter();

  // ── Create dialog ────────────────────────────────────────────────────────────
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [createShowAdvanced, setCreateShowAdvanced] = useState(false);

  // ── Edit dialog ──────────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<TestCaseItem | null>(null);
  const [editShowAdvanced, setEditShowAdvanced] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Delete confirm ───────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<TestCaseItem | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);

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
  const [runCaseTagFilter, setRunCaseTagFilter] = useState<string[]>([]);
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
      setCreateShowAdvanced(false);
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
    setEditShowAdvanced(false);
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

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletingCase(true);

    try {
      const response = await fetch(`/api/test-cases/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Unable to delete test case.");
        return;
      }
      toast.success("Test case deleted.");
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setDeletingCase(false);
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
      {/* ── Create test case dialog ── */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) {
            setCreateShowAdvanced(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>New test case</DialogTitle>
            <DialogDescription>Add a new test case to this project.</DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={createTestCase}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <CaseFormFields
                showAdvanced={createShowAdvanced}
                setShowAdvanced={setCreateShowAdvanced}
                testCasePrefix={testCasePrefix}
              />
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingCase} className="w-full sm:w-auto">
                {creatingCase ? "Saving…" : "Create test case"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit test case dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-4 pt-4 pb-4">
            <DialogTitle>Edit test case</DialogTitle>
            <DialogDescription>Update the test case details.</DialogDescription>
          </DialogHeader>
          <form key={editTarget?.id} className="flex min-h-0 flex-1 flex-col" onSubmit={saveEdit}>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <CaseFormFields
                showAdvanced={editShowAdvanced}
                setShowAdvanced={setEditShowAdvanced}
                defaults={editTarget ?? undefined}
                testCasePrefix={testCasePrefix}
                readOnlyDisplayId={editTarget?.displayId}
              />
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit} className="w-full sm:w-auto">
                {savingEdit ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[min(95vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Delete test case?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; will be permanently deleted. Historical run data remains untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" className="w-full sm:w-auto" disabled={deletingCase} onClick={confirmDelete}>
              {deletingCase ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* ── Page header ── */}
      <header className="flex items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Test suite</p>
          <h1 className="text-2xl font-semibold mt-0.5">Test Cases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {testCases.length === 0
              ? "No test cases yet — create your first one."
              : `${testCases.length} case${testCases.length !== 1 ? "s" : ""} in this project.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImportDialog(true)}>
            Import
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New test case
          </Button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <Tabs defaultValue="cases">
        <TabsList className="mb-6">
          <TabsTrigger value="cases">
            All cases
            {testCases.length > 0 && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {testCases.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="suites">
            Suites
            {suites.length > 0 && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {suites.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="run">
            Manual run
            {activeManualRun && (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-[var(--warning)]" aria-label="Active run" />
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            History
            {completedRuns.length > 0 && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {completedRuns.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── All cases tab ── */}
        <TabsContent value="cases">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Input
                type="search"
                placeholder="Search by title or module…"
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                className="max-w-sm"
              />
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm">
                  <span className="font-medium text-destructive">{selectedIds.size} selected</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setShowBulkDeleteDialog(true)}
                  >
                    Delete selected
                  </Button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear selection"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* ── Tag + imported-only filter chips ── */}
            {(distinctTags.length > 0 || testCases.some((tc) => tc.importBatchId)) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {distinctTags.map((tag) => {
                  const active = caseTagFilter.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() =>
                        setCaseTagFilter((cur) =>
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
                {testCases.some((tc) => tc.importBatchId) && (
                  <button
                    type="button"
                    onClick={() => setShowImportedOnly((v) => !v)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                      showImportedOnly
                        ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    📥 Imported only
                  </button>
                )}
                {(caseSearch || caseTagFilter.length > 0 || showImportedOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCaseSearch("");
                      setCaseTagFilter([]);
                      setShowImportedOnly(false);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {/* ── Import batch banners ── */}
            {importBatches.length > 0 && (
              <div className="space-y-2">
                {importBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center gap-3 rounded-lg border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50/60 dark:border-amber-800 dark:border-l-amber-500 dark:bg-amber-900/20 px-4 py-2.5"
                  >
                    <div className="flex-1 min-w-0 text-sm text-amber-800 dark:text-amber-200">
                      <span className="font-medium">{batch.caseCount}</span> case{batch.caseCount !== 1 ? "s" : ""} imported from{" "}
                      <span className="font-semibold">{batch.filename}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => undoBatch(batch.id)}
                      className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                    >
                      Undo all
                    </button>
                    <button
                      type="button"
                      onClick={() => selectBatchCases(batch.id)}
                      className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                    >
                      Select imported
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissBatch(batch.id)}
                      className="shrink-0 rounded p-0.5 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                      title="Dismiss"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {filteredCases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
                {testCases.length === 0 ? (
                  <>
                    <p className="text-sm font-medium">No test cases yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create your first test case or import from a file.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button variant="outline" onClick={() => setShowImportDialog(true)}>Import</Button>
                      <Button onClick={() => setShowCreateDialog(true)}>New test case</Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No test cases match your search.</p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={filteredCases.length > 0 && filteredCases.every((tc) => selectedIds.has(tc.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredCases.map((tc) => tc.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Case ID</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Title</th>
                      <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground sm:table-cell">Module</th>
                      <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground md:table-cell">Jira</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Priority</th>
                      <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground md:table-cell">Status</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {filteredCases.map((tc) => (
                      <tr
                        key={tc.id}
                        className={cn(
                          "hover:bg-muted/30 transition-colors",
                          selectedIds.has(tc.id) && "bg-muted/20",
                          tc.importBatchId && "[box-shadow:inset_4px_0_0_#f59e0b]"
                        )}
                      >
                        <td className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            className="rounded border-border"
                            checked={selectedIds.has(tc.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(tc.id);
                              else next.delete(tc.id);
                              setSelectedIds(next);
                            }}
                            aria-label={`Select ${tc.displayId}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums">{tc.displayId}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{tc.title}</span>
                            {tc.importBatchId && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Imported
                              </span>
                            )}
                          </div>
                          {tc.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{tc.description}</p>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          {tc.module ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tc.module}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
                          {tc.jiraKey ? <span className="font-medium">{tc.jiraKey}</span> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={PRIORITY_VARIANT[tc.priority] ?? "outline"} className="text-xs">
                            {tc.priority}
                          </Badge>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <span className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${CASE_STATUS_DOT[tc.status] ?? "bg-muted-foreground"}`} />
                            <span className="text-xs capitalize text-muted-foreground">{tc.status.toLowerCase()}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(tc)}
                              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title="Edit"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(tc)}
                              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Suites tab ── */}
        <TabsContent value="suites">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShowCreateSuiteDialog(true)} disabled={testCases.length === 0}>
                <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New suite
              </Button>
            </div>

            {suites.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
                <p className="text-sm font-medium">No test suites yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Group test cases together into suites for organised runs.
                </p>
                {testCases.length > 0 && (
                  <Button className="mt-4" onClick={() => setShowCreateSuiteDialog(true)}>
                    New suite
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {suites.map((suite) => (
                  <div key={suite.id} className="rounded-xl border border-border overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedSuite(expandedSuite === suite.id ? null : suite.id)}
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          className={`h-4 w-4 text-muted-foreground transition-transform ${expandedSuite === suite.id ? "rotate-90" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <div>
                          <p className="font-medium text-sm">{suite.name}</p>
                          {suite.description && (
                            <p className="text-xs text-muted-foreground">{suite.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {suite.cases.length} case{suite.cases.length !== 1 ? "s" : ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openManageSuiteDialog(suite);
                          }}
                        >
                          Manage cases
                        </Button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); deleteSuite(suite.id); }}
                          disabled={deletingSuiteId === suite.id}
                          className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete suite"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {expandedSuite === suite.id && (
                      <div className="divide-y divide-border">
                        {suite.cases.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-muted-foreground">No cases in this suite.</p>
                        ) : (
                          suite.cases.map((sc) => (
                            <div key={sc.id} className="flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/20 transition-colors">
                              <div className="flex-1">
                                <p className="text-sm font-medium">{sc.testCase.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {sc.testCase.displayId}
                                  {sc.testCase.jiraKey ? ` · ${sc.testCase.jiraKey}` : ""}
                                </p>
                              </div>
                              {sc.testCase.module && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                  {sc.testCase.module.name}
                                </span>
                              )}
                              <Badge variant={PRIORITY_VARIANT[sc.testCase.priority] ?? "outline"} className="text-xs">
                                {sc.testCase.priority}
                              </Badge>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Manual run tab ── */}
        <TabsContent value="run">
          <div className="space-y-6">
            {/* Active run banner */}
            {activeManualRun && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--warning)] bg-[oklch(from_var(--warning)_l_c_h_/_0.08)] px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--warning)]">
                    Active run
                  </p>
                  <p className="mt-0.5 font-semibold">{activeManualRun.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {activeManualRun.results.filter((r) => r.status !== "BLOCKED").length} of{" "}
                    {activeManualRun.results.length} tested
                  </p>
                </div>
                <a href={`/dashboard/${projectId}/tests/run/${activeManualRun.id}`}>
                  <Button>
                    Continue testing
                    <svg
                      className="ml-1.5 h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Button>
                </a>
              </div>
            )}

            {/* New run form */}
            <div className="max-w-lg space-y-4">
              {/* Suite picker */}
              {suites.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Start from suite</Label>
                  <Select
                    value={selectedSuiteId ?? "none"}
                    onValueChange={(val) => {
                      if (val === "none") {
                        setSelectedSuiteId(null);
                        setSelectedCases([]);
                      } else {
                        setSelectedSuiteId(val);
                        const suite = suites.find((s) => s.id === val);
                        if (suite) setSelectedCases(suite.cases.map((c) => c.testCase.id));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a suite…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No suite —</SelectItem>
                      {suites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}{" "}
                          <span className="text-muted-foreground">({s.cases.length})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Selecting a suite pre-fills the cases below — you can still adjust individually.
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold">Select test cases</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {testCases.length > 0
                    ? `${testCases.length} available`
                    : "No test cases yet — create some first."}
                </p>
              </div>

              {testCases.length > 0 && (
                <Input
                  type="search"
                  placeholder="Search…"
                  value={runCaseSearch}
                  onChange={(e) => setRunCaseSearch(e.target.value)}
                />
              )}

              {distinctTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {distinctTags.map((tag) => {
                    const active = runCaseTagFilter.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setRunCaseTagFilter((cur) =>
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
                  {(runCaseSearch || runCaseTagFilter.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setRunCaseSearch("");
                        setRunCaseTagFilter([]);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}

              <div className="relative max-h-56 overflow-auto rounded-lg border border-border">
                <div className="space-y-0.5 p-2">
                  {filteredRunCases.map((testCase) => {
                    const selected = selectedCases.includes(testCase.id);
                    return (
                      <label
                        key={testCase.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCases((cur) => [...cur, testCase.id]);
                            } else {
                              setSelectedCases((cur) => cur.filter((id) => id !== testCase.id));
                            }
                          }}
                        />
                        <span className="flex-1 truncate">{testCase.title}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {testCase.displayId}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {testCase.module && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {testCase.module}
                            </span>
                          )}
                          <Badge
                            variant={PRIORITY_VARIANT[testCase.priority] ?? "outline"}
                            className="px-1 py-0 text-xs"
                          >
                            {testCase.priority}
                          </Badge>
                        </span>
                      </label>
                    );
                  })}
                  {filteredRunCases.length === 0 && (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      {testCases.length === 0 ? "No test cases yet." : "No matches."}
                    </p>
                  )}
                </div>
              </div>

              {selectedCases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedCases.length} case{selectedCases.length !== 1 ? "s" : ""} selected
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="run-name">Run name</Label>
                <Input
                  id="run-name"
                  type="text"
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  placeholder="e.g. Sprint 12 smoke test"
                />
              </div>

              <Button
                type="button"
                disabled={!selectedCases.length || creatingRun}
                onClick={createManualRun}
                className="w-full"
              >
                {creatingRun ? "Creating run…" : "Start manual run"}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history">
          {completedRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
              <p className="text-sm font-medium">No completed runs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Completed manual runs will appear here with links to their reports.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedRuns.map((run) => {
                const passRate =
                  run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
                const date = run.completedAt
                  ? new Date(run.completedAt).toLocaleString()
                  : new Date(run.startedAt).toLocaleString();
                return (
                  <div
                    key={run.id}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{run.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{date}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 text-sm">
                      <span className="text-[var(--success)] font-semibold">
                        {run.passed} passed
                      </span>
                      {run.failed > 0 && (
                        <span className="text-destructive font-semibold">{run.failed} failed</span>
                      )}
                      <span className="text-muted-foreground">{passRate}%</span>
                    </div>
                    <a href={`/report/runs/${run.id}`}>
                      <Button variant="outline" size="sm">
                        View report
                      </Button>
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
