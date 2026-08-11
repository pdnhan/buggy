import { parseStringPromise } from "xml2js";
import { categoryForStatus } from "@/lib/failure-category";

type ResultStatus = "PASSED" | "FAILED" | "SKIPPED" | "ERROR";

// `explicitArray: false` means `failure`/`error` can come back as an
// object (`{ _, $ }`), a plain string (text-only or empty element), or an
// array of either when the element repeats.
type FailureNode = { _?: string; $?: Record<string, string> } | string;

type XmlNode = {
  $?: Record<string, string>;
  testsuite?: XmlNode | XmlNode[];
  // A `<testsuites>` element can itself nest another `<testsuites>` (real
  // merged/aggregated CI reports do this). Must be walked just like
  // `testsuite` or cases underneath it are silently dropped.
  testsuites?: XmlNode | XmlNode[];
  testcase?: XmlNode | XmlNode[];
  failure?: FailureNode | FailureNode[];
  error?: FailureNode | FailureNode[];
  skipped?: unknown;
};

export type ParsedJUnitResult = {
  name: string;
  suite: string;
  status: ResultStatus;
  durationMs: number;
  failureMessage: string | null;
  stackTrace: string | null;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// xml2js is called with `explicitArray: false`, which maps an EMPTY
// element (e.g. bare `<failure/>`) to the empty string `""` — a falsy
// value. Bare `<failure/>`/`<error/>`/`<skipped/>` are legal JUnit XML
// emitted by real reporters, so truthiness checks silently record failing
// tests as PASSED. Test PRESENCE instead: `undefined`/`null` means the
// element was absent, anything else (including `""` and `[]`) means it
// was present. An empty array is also treated as absent defensively, in
// case the parser shape ever changes to always produce arrays.
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function statusFromCase(testCase: XmlNode): ResultStatus {
  if (isPresent(testCase.failure)) return "FAILED";
  if (isPresent(testCase.error)) return "ERROR";
  if (isPresent(testCase.skipped)) return "SKIPPED";
  return "PASSED";
}

function readFailure(testCase: XmlNode): { message: string | null; stack: string | null } {
  const failure = toArray(testCase.failure)[0];
  const error = toArray(testCase.error)[0];
  const payload = failure ?? error;

  if (payload === undefined || payload === null) {
    return { message: null, stack: null };
  }

  // With `explicitArray: false`, a text-only element like
  // `<failure>the stack</failure>` is parsed as a plain STRING, not an
  // object — there is no `.message` and no `._`. Treat the string itself
  // as the stack trace. A bare `<failure/>` parses to `""`, which should
  // still resolve to `{ message: null, stack: null }`.
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return { message: null, stack: trimmed || null };
  }

  return {
    message: payload.$?.message ?? null,
    stack: payload._?.trim() || null,
  };
}

// Real (merged/aggregated) JUnit documents can nest `<testsuites>` inside
// `<testsuites>` to arbitrary depth. A pathological/malicious document could
// nest thousands of levels deep, which would otherwise blow the call stack
// or waste CPU; cap the depth we're willing to walk. 100 is far beyond any
// legitimate report shape while staying well under stack-overflow limits.
const MAX_NESTING_DEPTH = 100;

// `durationMs` is stored in an `Int?` column (PostgreSQL `integer`, max
// 2_147_483_647). A `time` attribute that is negative, absurdly large, or
// in scientific notation would previously survive the `NaN`/`Infinity`
// guard, overflow the column on insert, and surface to the operator as a
// generic "Unable to parse JUnit XML" parse error instead of the real
// cause. Clamp seconds to [0, MAX_DURATION_SECONDS] so the resulting
// milliseconds value always fits comfortably inside the column's range.
const MAX_DURATION_SECONDS = 2_147_483;

// Accept only a plain decimal number (JUnit's documented `time` format):
// optional sign, digits, optional fractional part, optional exponent.
// `Number("0x10")` would otherwise silently parse hex strings like "0x10"
// as 16 — that is not a real-world JUnit duration format, so it's rejected
// (treated as absent/invalid) rather than silently accepted.
const DECIMAL_TIME_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseDurationMs(rawTime: string | undefined): number {
  if (rawTime === undefined) return 0;

  const trimmed = rawTime.trim();
  if (!DECIMAL_TIME_PATTERN.test(trimmed)) return 0;

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) return 0;

  const clampedSeconds = Math.min(Math.max(seconds, 0), MAX_DURATION_SECONDS);
  return Math.round(clampedSeconds * 1000);
}

function collectCases(node: XmlNode, suitePath: string[], depth: number): ParsedJUnitResult[] {
  if (depth > MAX_NESTING_DEPTH) return [];

  const ownSuiteName = node.$?.name?.trim();
  const currentPath = ownSuiteName ? [...suitePath, ownSuiteName] : suitePath;
  const suiteName = currentPath.join(" > ") || "Root Suite";

  // `<testcase>` can appear directly under a `<testsuites>` wrapper, not
  // just under a `<testsuite>` — collect it at whatever level it's found.
  const directCases = toArray(node.testcase).map((testCase) => {
    const status = statusFromCase(testCase);
    const details = readFailure(testCase);
    const testName = testCase.$?.name?.trim() || "Unnamed test";

    return {
      name: testName,
      suite: suiteName,
      status,
      durationMs: parseDurationMs(testCase.$?.time),
      failureMessage: details.message,
      stackTrace: details.stack,
    };
  });

  // Recurse through BOTH `testsuite` and `testsuites` children — a nested
  // `<testsuites>` wrapper is exactly the shape that previously hid failing
  // cases entirely (CQ-130).
  const nestedTestsuite = toArray(node.testsuite).flatMap((child) =>
    collectCases(child, currentPath, depth + 1)
  );
  const nestedTestsuites = toArray(node.testsuites).flatMap((child) =>
    collectCases(child, currentPath, depth + 1)
  );

  return [...directCases, ...nestedTestsuite, ...nestedTestsuites];
}

export async function parseJUnitXml(xml: string): Promise<ParsedJUnitResult[]> {
  const parsed = (await parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: false,
    trim: true,
  })) as { testsuites?: XmlNode | XmlNode[]; testsuite?: XmlNode | XmlNode[] };

  // An XML document has exactly one root, so only one of these is ever
  // populated in practice; both are handled defensively.
  const roots = [...toArray(parsed.testsuite), ...toArray(parsed.testsuites)];

  return roots.flatMap((root) => collectCases(root, [], 0));
}

export function summarizeStatuses(results: ParsedJUnitResult[]) {
  return results.reduce(
    (acc, result) => {
      if (result.status === "PASSED") acc.passed += 1;
      if (result.status === "FAILED") acc.failed += 1;
      if (result.status === "SKIPPED") acc.skipped += 1;
      if (result.status === "ERROR") acc.error += 1;
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0, error: 0 }
  );
}

export function toCreateResultData(results: ParsedJUnitResult[]) {
  return results.map((result) => ({
    name: result.name,
    suite: result.suite,
    status: result.status,
    durationMs: result.durationMs,
    failureMessage: result.failureMessage,
    stackTrace: result.stackTrace,
    category: categoryForStatus(result.status, result.failureMessage, result.stackTrace),
  }));
}
