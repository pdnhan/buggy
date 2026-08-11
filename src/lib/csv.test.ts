import { describe, it, expect } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csvCell", () => {
  it("passes plain values through unchanged", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("maps null and undefined to an empty string", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and doubles embedded double quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("quotes a value containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  // The bug this fixes: the old escapeCsv() in api/bugs/export/route.ts
  // matched /[",\n]/ only and let a bare \r straight through unescaped.
  it("quotes a value containing a bare carriage return", () => {
    expect(csvCell("line1\rline2")).toBe('"line1\rline2"');
  });

  it("quotes a value containing CRLF", () => {
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  // Formula/DDE injection: a leading =, +, -, @, tab, or CR is how
  // Excel/Sheets recognize a formula when the CSV is opened. Prefixing a
  // single quote forces it to render as literal text instead.
  it.each([
    ["=CMD('/C calc')!A0", "'=CMD('/C calc')!A0"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["\tformula-ish", "'\tformula-ish"],
  ])("prefixes a formula-triggering value %j with a single quote", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  // A leading CR is both a formula trigger AND a structural character (it
  // can itself break a row), so the result gets the formula prefix AND the
  // RFC 4180 quoting — unlike the other triggers, which don't also need
  // structural quoting on their own.
  it("prefixes AND quotes a value starting with a carriage return", () => {
    expect(csvCell("\rformula-ish")).toBe('"\'\rformula-ish"');
  });

  it("does not prefix a value that merely CONTAINS, but doesn't START WITH, a trigger character", () => {
    expect(csvCell("total=5")).toBe("total=5");
    expect(csvCell("a-b-c")).toBe("a-b-c");
  });

  it("quotes a value that needed a formula prefix AND contains a comma", () => {
    // The formula-prefix ' is applied first, then the whole (now longer)
    // string is checked for structural characters and quoted if needed.
    expect(csvCell("=A1,B1")).toBe('"\'=A1,B1"');
  });

  it("a genuine number never carries an attacker formula, so it stays a real, unquoted number — including negatives", () => {
    // A `number` is computed by the app, not taken verbatim from
    // attacker-controlled input, so there's no formula-injection risk to
    // defend against: -5 stays numeric -5 in spreadsheet software, not
    // text "'-5".
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(5)).toBe("5");
    expect(csvCell(0)).toBe("0");
  });

  it("still prefixes a STRING that merely looks like a triggering value (e.g. an attacker-controlled id)", () => {
    // Unlike a real `number`, a string of "-5" (or "-1+1") could be
    // attacker-controlled (an externalIssueId, a title, ...) and IS a
    // formula trigger when Excel/Sheets open it, so it must still be
    // defended.
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("-1+1")).toBe("'-1+1");
  });

  // Whitespace-bypass: Excel/LibreOffice trim leading whitespace-like
  // characters on an unquoted field before deciding it's a formula, so a
  // trigger character preceded by one of these still executes even though
  // it isn't at string index 0. Every neutral character is spelled with an
  // explicit \u escape (rather than a raw invisible byte) so the test
  // source stays unambiguous.
  it.each([
    // [label, input, alsoStructural] — a leading LF/CR is simultaneously a
    // formula trigger AND a structural character (see the CR case above),
    // so those two additionally pick up RFC 4180 quoting.
    ["leading space", " =1+1", false],
    ["leading tab", "\t=1+1", false],
    ["leading LF", "\n=1+1", true],
    ["leading CR", "\r=1+1", true],
    ["leading NBSP (U+00A0)", "\u00A0=1+1", false],
    ["leading ZWSP (U+200B)", "\u200B=1+1", false],
    ["leading BOM (U+FEFF)", "\uFEFF=1+1", false],
    ["multiple leading neutral chars", "  \t \u00A0=cmd|'/c calc'!A0", false],
  ] as const)(
    "prefixes %s before a formula trigger, keeping the original value's whitespace intact",
    (_label, input, alsoStructural) => {
      const result = csvCell(input);
      const prefixed = `'${input}`;
      // The prefix is a single `'` in front of the ORIGINAL, untouched
      // value — csvCell only looks past the leading neutral run to decide
      // whether to prefix, it never rewrites the value itself.
      expect(result).toBe(alsoStructural ? `"${prefixed}"` : prefixed);
    }
  );

  it("does not prefix leading whitespace alone when nothing that follows is a trigger", () => {
    expect(csvCell("  hello")).toBe("  hello");
  });
});

describe("csvRow", () => {
  it("escapes every cell and joins with commas", () => {
    expect(csvRow(["a", "b,c", 3, null])).toBe('a,"b,c",3,');
  });

  it("handles an all-safe row without adding any quoting", () => {
    expect(csvRow(["Bug ID", "Title", "Severity"])).toBe("Bug ID,Title,Severity");
  });
});
