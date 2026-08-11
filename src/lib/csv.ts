// Shared CSV-cell escaping — every CSV export in the app (bug register
// export, monthly quality KPI export, and any future one) must route every
// interpolated value through this, preamble/comment rows included. See
// CQ-110.
//
// Two independent problems, one helper:
//
// 1. CSV structural injection: a value containing a comma, quote, or
//    newline can silently merge/split cells or rows if not escaped. RFC
//    4180 escaping is: wrap in double quotes, double any embedded quotes.
//    The old `escapeCsv()` in the bugs export route matched on
//    `/[",\n]/` only — it MISSED `\r` (a lone CR, or the CR half of a CRLF
//    supplied by an attacker-controlled field like a bug title or project
//    name, can still break a row apart in spreadsheet software that
//    splits on bare CR).
//
// 2. CSV/formula injection ("DDE injection"): Excel, Sheets, and others
//    treat a cell whose content starts with `=`, `+`, `-`, `@`, a tab, or
//    a carriage return as a FORMULA when the file is opened — an
//    attacker-controlled field (bug title, project name, notes, an
//    externalIssueId, ...) that starts with e.g. `=CMD(...)` can execute
//    when a victim opens the exported CSV. Prefixing a `'` neutralizes it
//    (Excel/Sheets render literal text) without changing what a human sees.
//
//    Excel and LibreOffice TRIM leading whitespace-like characters on an
//    unquoted field before deciding whether it's a formula — so
//    " =1+1" (leading space), "\n=1+1", a leading NBSP (U+00A0), a leading
//    ZERO WIDTH SPACE (U+200B), or a leading UTF-8 BOM (U+FEFF) all still
//    land the trigger character at effective column 0 once the sheet
//    renders it. `CSV_FORMULA_TRIGGER_RE` anchors on `^`, so it must be
//    tested against a copy of the value with that same leading run
//    stripped — the ORIGINAL value (whitespace included) is still what
//    gets written out; only the trigger *check* looks past it.
const CSV_STRUCTURAL_RE = /["\n\r,]/;
const CSV_FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;
// Leading run of characters a spreadsheet application trims/skips before
// evaluating formula-ness: regular space, LF, NBSP (U+00A0), ZERO WIDTH
// SPACE (U+200B), and the BOM / ZERO WIDTH NO-BREAK SPACE (U+FEFF).
//
// Deliberately does NOT include tab or CR even though they're
// whitespace-ish: both are already members of CSV_FORMULA_TRIGGER_RE
// itself, so a leading tab/CR still matches that regex directly at
// position 0 without needing to be stripped first — stripping them here
// too would consume the very character the trigger check is looking for
// (e.g. "\tformula-ish" would become "formula-ish", no longer looking
// like a trigger) and silently defeat the existing tab/CR defense.
const CSV_FORMULA_LEADING_NEUTRAL_RE = /^[ \n\u00A0\u200B\uFEFF]+/;

// Formats one value as a single, safe CSV cell. `null`/`undefined` become
// the empty string (matches how every caller already treated missing data).
export function csvCell(value: string | number | boolean | null | undefined): string {
  // A genuine `number` (as opposed to a string that merely looks numeric)
  // can never carry an attacker-supplied formula — it was computed, not
  // taken verbatim from user input — so it is exported as a real number
  // rather than defensively text-prefixed. Every OTHER value (string,
  // boolean, stringified id, ...) still goes through the formula-trigger
  // check, including strings that happen to look like negative numbers
  // (e.g. an attacker-controlled externalIssueId of "-1+1").
  const isNumber = typeof value === "number";
  let str = value === null || value === undefined ? "" : String(value);

  if (!isNumber) {
    const forTriggerCheck = str.replace(CSV_FORMULA_LEADING_NEUTRAL_RE, "");
    if (CSV_FORMULA_TRIGGER_RE.test(forTriggerCheck)) {
      str = `'${str}`;
    }
  }

  if (CSV_STRUCTURAL_RE.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

// Joins already-individual values into one CSV row, escaping each cell.
export function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(csvCell).join(",");
}
