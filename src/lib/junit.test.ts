import { describe, it, expect } from "vitest";
import { parseJUnitXml, summarizeStatuses, toCreateResultData } from "./junit";

describe("parseJUnitXml", () => {
  describe("status detection (regression guards for the empty-element bug)", () => {
    it("bare <failure/> is FAILED, not PASSED", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"><failure/></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("FAILED");
    });

    it("bare <error/> is ERROR, not PASSED", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"><error/></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("ERROR");
    });

    it("bare <skipped/> is SKIPPED, not PASSED", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"><skipped/></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("SKIPPED");
    });

    it("a testcase with no failure/error/skipped child is PASSED", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("PASSED");
      expect(result.failureMessage).toBeNull();
      expect(result.stackTrace).toBeNull();
    });
  });

  describe("failure message/stack extraction", () => {
    it("extracts message attribute and text stack from an object-shaped failure", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1">
            <failure message="x">stack</failure>
          </testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("FAILED");
      expect(result.failureMessage).toBe("x");
      expect(result.stackTrace).toBe("stack");
    });

    it("treats a text-only <failure>stack text</failure> as the stack trace", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"><failure>stack text</failure></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("FAILED");
      expect(result.failureMessage).toBeNull();
      expect(result.stackTrace).toBe("stack text");
    });

    it("bare <failure/> yields null message and null stack", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1"><failure/></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.failureMessage).toBeNull();
      expect(result.stackTrace).toBeNull();
    });

    it("extracts message/stack from an <error> the same way as <failure>", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="0.1">
            <error message="boom">error stack</error>
          </testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.status).toBe("ERROR");
      expect(result.failureMessage).toBe("boom");
      expect(result.stackTrace).toBe("error stack");
    });
  });

  describe("duration parsing", () => {
    it("falls back to 0ms for a non-numeric time attribute instead of NaN", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="abc"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.durationMs).toBe(0);
      expect(Number.isNaN(result.durationMs)).toBe(false);
    });

    it("converts a fractional seconds time attribute to milliseconds", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1" time="1.5"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.durationMs).toBe(1500);
    });

    it("defaults to 0ms when the time attribute is absent", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase name="t1"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.durationMs).toBe(0);
    });

    // Regression coverage for CQ-140: the NaN/Infinity guard let negative
    // and absurdly large `time` values through, producing a `durationMs`
    // that overflows the `Int` column (max 2_147_483_647) and turns a
    // range error into a misleading "Unable to parse JUnit XML" response.
    describe("clamps out-of-range time values (CQ-140)", () => {
      it("clamps a negative time to 0ms instead of a negative duration", async () => {
        const xml = `<testsuite name="Suite"><testcase name="t1" time="-1"></testcase></testsuite>`;
        const [result] = await parseJUnitXml(xml);
        expect(result.durationMs).toBe(0);
      });

      it("clamps a very large time so the resulting ms value fits in a Postgres Int column", async () => {
        const xml = `<testsuite name="Suite"><testcase name="t1" time="3000000"></testcase></testsuite>`;
        const [result] = await parseJUnitXml(xml);
        expect(result.durationMs).toBeLessThanOrEqual(2_147_483_647);
        expect(result.durationMs).toBe(2_147_483_000);
      });

      it("clamps scientific-notation time so it can't overflow the Int column", async () => {
        const xml = `<testsuite name="Suite"><testcase name="t1" time="1e15"></testcase></testsuite>`;
        const [result] = await parseJUnitXml(xml);
        expect(result.durationMs).toBeLessThanOrEqual(2_147_483_647);
        expect(result.durationMs).toBe(2_147_483_000);
      });

      it("rejects a hex time literal instead of silently parsing it as decimal", async () => {
        // Number("0x10") === 16, which would silently be accepted as 16s —
        // not a real JUnit `time` format, so it's treated as invalid (0ms)
        // rather than a lucky/unlucky guess at the author's intent.
        const xml = `<testsuite name="Suite"><testcase name="t1" time="0x10"></testcase></testsuite>`;
        const [result] = await parseJUnitXml(xml);
        expect(result.durationMs).toBe(0);
      });
    });
  });

  describe("suite structure", () => {
    it("parses a nested <testsuites><testsuite> document", async () => {
      const xml = `
        <testsuites>
          <testsuite name="Outer">
            <testcase name="t1" time="0.1"></testcase>
          </testsuite>
        </testsuites>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(1);
      expect(results[0].suite).toBe("Outer");
      expect(results[0].name).toBe("t1");
    });

    it("parses a bare top-level <testsuite> (no wrapping <testsuites>)", async () => {
      const xml = `
        <testsuite name="Bare">
          <testcase name="t1" time="0.1"></testcase>
        </testsuite>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(1);
      expect(results[0].suite).toBe("Bare");
    });

    it("joins nested suite names with ' > '", async () => {
      const xml = `
        <testsuites>
          <testsuite name="A">
            <testsuite name="B">
              <testcase name="t1" time="0.1"></testcase>
            </testsuite>
          </testsuite>
        </testsuites>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(1);
      expect(results[0].suite).toBe("A > B");
    });

    it("falls back to 'Unnamed test' when the testcase has no name", async () => {
      const xml = `
        <testsuite name="Suite">
          <testcase time="0.1"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.name).toBe("Unnamed test");
    });

    it("falls back to 'Root Suite' when no suite in the path has a name", async () => {
      const xml = `
        <testsuite>
          <testcase name="t1" time="0.1"></testcase>
        </testsuite>`;
      const [result] = await parseJUnitXml(xml);
      expect(result.suite).toBe("Root Suite");
    });
  });

  // Regression coverage for CQ-130: a previous fix stopped bare
  // <failure/> from parsing as PASSED, but `parseJUnitXml` only descended
  // one `testsuites` level and never recursed into a nested `<testsuites>`.
  // A merged/aggregated CI report with a nested `<testsuites>` wrapper
  // would silently drop every case underneath it — including FAILED ones —
  // while `parsed.length` stayed non-zero, so the upload route's
  // empty-check never caught it and the run was recorded as fully green.
  describe("arbitrarily nested <testsuites> (CQ-130)", () => {
    it("finds a testsuite nested two levels inside <testsuites><testsuites>", async () => {
      const xml = `
        <testsuites>
          <testsuites>
            <testsuite name="Deep">
              <testcase name="t1" time="0.1"></testcase>
            </testsuite>
          </testsuites>
        </testsuites>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("t1");
      expect(results[0].suite).toBe("Deep");
    });

    it("finds a <testcase> that sits directly under <testsuites>", async () => {
      const xml = `
        <testsuites>
          <testcase name="ORPHAN-FAIL"><failure message="boom"/></testcase>
        </testsuites>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ORPHAN-FAIL");
      expect(results[0].status).toBe("FAILED");
    });

    it("does not drop a failing case hidden behind a nested <testsuites> in a mixed document", async () => {
      const xml = `
        <testsuites>
          <testsuite name="Visible"><testcase name="ok" time="0.1"></testcase></testsuite>
          <testsuites name="Merged">
            <testsuite name="Hidden">
              <testcase name="FAILING-ONE" time="0.1"><failure message="real failure"/></testcase>
            </testsuite>
          </testsuites>
        </testsuites>`;
      const results = await parseJUnitXml(xml);
      expect(results).toHaveLength(2);

      const names = results.map((r) => r.name);
      expect(names).toContain("ok");
      expect(names).toContain("FAILING-ONE");

      const failing = results.find((r) => r.name === "FAILING-ONE");
      expect(failing?.status).toBe("FAILED");
      expect(failing?.suite).toBe("Merged > Hidden");
    });

    it("guards against pathological nesting depth without crashing or hanging", async () => {
      const depth = 5000;
      const xml =
        "<testsuites>".repeat(depth) +
        '<testsuite name="Bottom"><testcase name="t1" time="0.1"></testcase></testsuite>' +
        "</testsuites>".repeat(depth);

      // Must resolve (not throw a stack overflow, not hang) even though the
      // case at the bottom sits beyond the depth guard and is dropped.
      await expect(parseJUnitXml(xml)).resolves.toBeInstanceOf(Array);
    });
  });
});

describe("summarizeStatuses", () => {
  it("tallies each status independently", () => {
    const summary = summarizeStatuses([
      { name: "a", suite: "s", status: "PASSED", durationMs: 0, failureMessage: null, stackTrace: null },
      { name: "b", suite: "s", status: "FAILED", durationMs: 0, failureMessage: null, stackTrace: null },
      { name: "c", suite: "s", status: "SKIPPED", durationMs: 0, failureMessage: null, stackTrace: null },
      { name: "d", suite: "s", status: "ERROR", durationMs: 0, failureMessage: null, stackTrace: null },
      { name: "e", suite: "s", status: "PASSED", durationMs: 0, failureMessage: null, stackTrace: null },
    ]);
    expect(summary).toEqual({ passed: 2, failed: 1, skipped: 1, error: 1 });
  });

  it("returns all zeros for an empty result set", () => {
    expect(summarizeStatuses([])).toEqual({ passed: 0, failed: 0, skipped: 0, error: 0 });
  });
});

describe("toCreateResultData", () => {
  it("maps parsed results to create-input shape and attaches a category for failures", () => {
    const data = toCreateResultData([
      {
        name: "t1",
        suite: "s",
        status: "FAILED",
        durationMs: 120,
        failureMessage: "Request failed with status code 500",
        stackTrace: null,
      },
    ]);
    expect(data).toEqual([
      {
        name: "t1",
        suite: "s",
        status: "FAILED",
        durationMs: 120,
        failureMessage: "Request failed with status code 500",
        stackTrace: null,
        category: "API",
      },
    ]);
  });

  it("leaves category null for passed/skipped results", () => {
    const data = toCreateResultData([
      { name: "t1", suite: "s", status: "PASSED", durationMs: 5, failureMessage: null, stackTrace: null },
      { name: "t2", suite: "s", status: "SKIPPED", durationMs: 0, failureMessage: null, stackTrace: null },
    ]);
    expect(data[0].category).toBeNull();
    expect(data[1].category).toBeNull();
  });
});
