import { FailureCategory, ResultStatus } from "@prisma/client";

/**
 * Categorizes a failure based on the error message and stack trace.
 * Uses heuristics to identify the most likely category.
 */

// ---------------------------------------------------------------------------
// Background (third attempt at this function — read before changing again).
//
// Short tokens ("api", "http", "db", "ui", "dom") are common substrings of
// unrelated words in FILE PATHS ("/api/", "/ui/") and of unrelated compound
// IDENTIFIERS ("HttpRequestException", "DbContext"). Two prior fixes each
// optimized one of those and broke the other:
//
//   1. Bare substring match: "build" contains "ui", "rapid" contains "api" —
//      misclassified prose and file paths constantly.
//   2. `(^|[^a-z])token([^a-z]|$)` non-letter-boundary match: file paths like
//      "/api/users" and "/ui/login" have non-letter neighbours (`/`) BY
//      CONSTRUCTION, so this never helped the file-path case at all — and it
//      broke every identifier where the token is glued to letters on both
//      sides ("HttpRequestException", "DbUpdateException", "DomNodeNotFound",
//      "ApiException", ...), because those have LETTER neighbours.
//
// The fix is to stop treating "the stack trace" and "the message" as one
// blob with one grammar. They aren't:
//
//   - File paths live in the STACK TRACE. That's the entire source of the
//     false-positive-on-path problem. So: never test short ambiguous tokens
//     against the stack trace at all. Only test them against the MESSAGE,
//     tokenized on real word boundaries (see `tokenizeMessage` below).
//   - Identifiers (the "HttpRequestException" family) are camelCase /
//     PascalCase / SCREAMING_SNAKE_CASE. A plain regex boundary can't see
//     the "word" boundary inside "HttpRequestException" — there isn't a
//     non-letter character there. So instead of matching a pattern against
//     raw text, the message is TOKENIZED (split on camelCase/acronym
//     boundaries as well as non-letter separators) and short tokens are
//     matched by set membership: "HttpRequestException" -> {http, request,
//     exception}; "DBNull" -> {db, null}. Whole-word prose ("build",
//     "rapid", "adblock", "random") tokenizes to itself and never
//     collides.
//   - Long, unambiguous signals ("prisma", "playwright", "econnrefused",
//     "postgres", "mongodb", "domexception", ...) are safe to match as
//     plain substrings against BOTH message and stack trace — they don't
//     occur as accidental substrings of unrelated words/paths.
// ---------------------------------------------------------------------------

interface CategoryRule {
  category: FailureCategory;
  // Long/unambiguous substrings or regexes, safe against the combined
  // (message + stack trace) text.
  textPatterns: (string | RegExp)[];
  // Short, ambiguous tokens ("api", "db", "ui", "dom", "http"/"https").
  // Matched ONLY against tokenized words of the MESSAGE — never the stack
  // trace, since stack traces are exactly where file paths live.
  messageTokens?: string[];
}

// Matches a phrase as whole word(s): `\b` boundaries stop "click" from
// matching inside "ClickHouse", "visible" inside "invisible", "expected"
// inside "unexpected", and "to be" inside "photo below" / "onto bed" (the
// literal substring "to be" spans those word boundaries, but `\bto\b`
// cannot match where "to" isn't its own word).
const wholeWord = (phrase: string) => new RegExp(`\\b${phrase.trim().replace(/\s+/g, "\\s+")}\\b`);

// Bounded alternative to `/expect\(.*\)\.to/` (CQ-132): the original used an
// unbounded `.*`, which is quadratic to backtrack across a message with many
// "expect(" occurrences and no matching ").to" (measured: ~9.7s for a 30,000
// occurrence / 210KB adversarial payload). `[^)]{0,300}` bounds the
// backtracking work for every "expect(" occurrence to a small constant
// instead of the remaining string length, making the whole scan linear in
// input size. Combined with the input-length cap in `categorizeFailure`,
// worst-case work is bounded twice over.
// No trailing `\b` after "to": real matcher calls continue directly into a
// method name (`.toBe(`, `.toEqual(`, `.toSatisfy(`), so the boundary must
// sit before "to", not after it.
const EXPECT_TO_PATTERN = /expect\([^)]{0,300}\)\s*\.\s*to/;

const CATEGORY_RULES: CategoryRule[] = [
  // Specific root causes are checked BEFORE the generic ASSERTION bucket
  // (CQ-133): nearly every assertion-library message contains "expected",
  // so if ASSERTION is checked first it systematically masks the real
  // cause — "expected 200 but got ECONNREFUSED" is a NETWORK failure,
  // "expected 1 row, prisma unique constraint failed" is a DATABASE
  // failure, "expected element to be visible, test timed out after
  // 30000ms" is a TIMEOUT, not a generic assertion mismatch.
  {
    category: "TIMEOUT",
    textPatterns: ["timed out", "timeout"],
  },
  {
    category: "NETWORK",
    textPatterns: ["econnrefused", "network", "fetch failed", "connection refused", "dns"],
  },
  {
    category: "API",
    textPatterns: ["status code", "request failed", "response status"],
    messageTokens: ["api", "http", "https"],
  },
  {
    category: "DATABASE",
    textPatterns: [
      "prisma",
      "database",
      "unique constraint",
      "sql",
      "postgres",
      "query failed",
      "mongodb",
    ],
    messageTokens: ["db"],
  },
  {
    category: "UI",
    textPatterns: [
      "locator",
      "playwright",
      "element",
      wholeWord("click"), // not "ClickHouse"
      wholeWord("visible"), // not "invisible"
      "selector",
      "page closed",
      "domexception",
    ],
    messageTokens: ["ui", "dom"],
  },
  {
    category: "ASSERTION",
    textPatterns: [
      wholeWord("expected"), // not "unexpected"
      "to equal",
      wholeWord("to be"), // not "photo below" / "onto bed"
      "assertion",
      EXPECT_TO_PATTERN,
    ],
  },
];

// Categorization only needs the leading portion of a message/stack to find
// its signal; capping the text also bounds the worst-case work of every
// pattern (substring scan or regex) regardless of how large the uploaded
// payload is (CQ-132: a 50MB JUnit upload categorizes every failed result).
const MAX_MATCH_LENGTH = 5_000;

// Splits an identifier/message into lowercase word tokens on:
//   - non-letter boundaries (digits, underscores, punctuation, whitespace,
//     slashes, colons, ...), and
//   - camelCase/PascalCase/acronym boundaries, so "HttpRequestException"
//     tokenizes to [http, request, exception], "DBNull" to [db, null], and
//     "DomNodeNotFound" to [dom, node, not, found] — while an ordinary word
//     like "build" or "random" tokenizes to itself and never collides with
//     "ui"/"dom".
function tokenizeMessage(message: string): Set<string> {
  const spaced = message
    // lower/digit immediately followed by upper: "httpRequest" -> "http Request"
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // acronym run immediately followed by a capitalized word: "HTTPError" -> "HTTP Error"
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return new Set(spaced.toLowerCase().split(/[^a-z]+/).filter(Boolean));
}

export function categorizeFailure(
  message: string | null | undefined,
  stackTrace: string | null | undefined
): FailureCategory {
  const rawMessage = (message ?? "").slice(0, MAX_MATCH_LENGTH);
  const rawStack = (stackTrace ?? "").slice(0, MAX_MATCH_LENGTH);
  const combined = `${rawMessage} ${rawStack}`.toLowerCase();

  if (!combined.trim()) return "UNKNOWN";

  const messageTokens = tokenizeMessage(rawMessage);

  for (const { category, textPatterns, messageTokens: shortTokens } of CATEGORY_RULES) {
    const textHit = textPatterns.some((pattern) =>
      typeof pattern === "string" ? combined.includes(pattern) : pattern.test(combined)
    );
    if (textHit) return category;

    if (shortTokens?.some((token) => messageTokens.has(token))) {
      return category;
    }
  }

  return "UNKNOWN";
}

export function categoryForStatus(
  status: ResultStatus,
  message?: string | null,
  stackTrace?: string | null
): FailureCategory | null {
  if (status === "PASSED" || status === "SKIPPED") {
    return null;
  }

  return categorizeFailure(message, stackTrace);
}
