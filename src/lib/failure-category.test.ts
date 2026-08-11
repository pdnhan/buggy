import { describe, it, expect } from "vitest";
import { categorizeFailure } from "./failure-category";
import { FailureCategory } from "@prisma/client";

describe("categorizeFailure", () => {
  it("categorizes assertion failures", () => {
    const message = "expected 'foo' to equal 'bar'";
    expect(categorizeFailure(message, undefined)).toBe("ASSERTION" as FailureCategory);
  });

  it("categorizes timeout failures", () => {
    const message = "Test timed out after 5000ms";
    expect(categorizeFailure(message, undefined)).toBe("TIMEOUT" as FailureCategory);
  });

  it("categorizes network failures", () => {
    const message = "fetch failed: ECONNREFUSED 127.0.0.1:3000";
    expect(categorizeFailure(message, undefined)).toBe("NETWORK" as FailureCategory);
  });

  it("categorizes API failures", () => {
    const message = "Request failed with status code 404";
    expect(categorizeFailure(message, undefined)).toBe("API" as FailureCategory);
  });

  it("categorizes database failures", () => {
    const message = "PrismaClientKnownRequestError: Unique constraint failed on the fields: (email)";
    expect(categorizeFailure(message, undefined)).toBe("DATABASE" as FailureCategory);
  });

  it("categorizes UI failures", () => {
    const message = "Error: locator.click: Target closed";
    const stack = "at Page.click (node_modules/playwright/lib/page.js:123:45)";
    expect(categorizeFailure(message, stack)).toBe("UI" as FailureCategory);
  });

  it("categorizes using regex patterns", () => {
    const message = "expect(received).toSatisfy(predicate)";
    expect(categorizeFailure(message, undefined)).toBe("ASSERTION" as FailureCategory);
  });

  it("returns UNKNOWN for unrecognized failures", () => {
    const message = "Something went wrong";
    expect(categorizeFailure(message, undefined)).toBe("UNKNOWN" as FailureCategory);
  });

  // Regression coverage for a real bug: short tokens ("api", "http", "db",
  // "ui", "dom") used to be matched as bare substrings, so any stack trace
  // containing an unrelated word that happens to contain one of them got
  // silently miscategorized.
  describe("does not misclassify on substring collisions in the stack trace", () => {
    it("a build path does not trigger UI ('ui' inside 'build')", () => {
      expect(categorizeFailure("Something broke", "at /app/build/runner.js:22")).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("a spec file named 'rapid-*' does not trigger API ('api' inside 'rapid')", () => {
      expect(categorizeFailure("Failure", "at /src/rapid-check.spec.ts:10")).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'adblock' does not trigger DATABASE ('db' inside 'adblock')", () => {
      expect(categorizeFailure("adblock extension interfered", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'random' does not trigger UI ('dom' inside 'random')", () => {
      expect(categorizeFailure("random flake, no real cause", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("still classifies a genuine standalone 'API' failure", () => {
      expect(categorizeFailure("API request failed", undefined)).toBe("API" as FailureCategory);
    });

    it("still classifies a genuine standalone 'UI' failure", () => {
      expect(categorizeFailure("UI element not interactable", undefined)).toBe(
        "UI" as FailureCategory
      );
    });

    it("a timeout with a URL in the stack is still TIMEOUT, not API", () => {
      expect(
        categorizeFailure(
          "Test timed out after 30000ms",
          "at page.goto (https://staging.example.com/login)"
        )
      ).toBe("TIMEOUT" as FailureCategory);
    });
  });

  // Regression coverage for the `\b`-anchoring regression: `\b` treats
  // digits/underscores as word characters, so it stopped matching real
  // compound tokens like "https://", "mongodb", "DOMException", and
  // "API_KEY". These must classify correctly again.
  describe("classifies real-world compound tokens that \\b anchoring broke", () => {
    it("a bare URL failure is API", () => {
      expect(categorizeFailure("https://svc/v2/users failed", undefined)).toBe(
        "API" as FailureCategory
      );
    });

    it("a mongodb connection error is DATABASE", () => {
      expect(categorizeFailure("mongodb connection error", undefined)).toBe(
        "DATABASE" as FailureCategory
      );
    });

    it("a DOMException is UI", () => {
      expect(categorizeFailure("DOMException: ...", undefined)).toBe("UI" as FailureCategory);
    });

    it("an API_KEY message is API", () => {
      expect(categorizeFailure("API_KEY missing", undefined)).toBe("API" as FailureCategory);
    });
  });

  // The fix for the \b regression must not reintroduce the original bare
  // substring bug: these words still must not accidentally classify.
  describe("still avoids substring collisions after the boundary fix", () => {
    it("'build' does not trigger UI", () => {
      expect(categorizeFailure("Something broke", "at /app/build/runner.js:22")).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'rapid' does not trigger API", () => {
      expect(categorizeFailure("Failure", "at /src/rapid-check.spec.ts:10")).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'adblock' does not trigger DATABASE", () => {
      expect(categorizeFailure("adblock extension interfered", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'random' does not trigger UI", () => {
      expect(categorizeFailure("random flake, no real cause", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });
  });

  // CQ-131: file paths in the STACK TRACE are the entire source of the
  // false-positive-on-substring problem ("/api/", "/ui/" always have
  // non-letter neighbours). Short ambiguous tokens must never be tested
  // against the stack trace at all, only against the tokenized message.
  describe("never matches short ambiguous tokens against the stack trace (CQ-131)", () => {
    it("a stack frame path containing /api/ does not trigger API on its own", () => {
      expect(
        categorizeFailure("Something broke", "at handler (/src/api/users/route.ts:12:3)")
      ).toBe("UNKNOWN" as FailureCategory);
    });

    it("a stack frame path containing /ui/ does not trigger UI on its own", () => {
      expect(
        categorizeFailure("Something broke", "at render (/src/ui/components/Button.tsx:5:1)")
      ).toBe("UNKNOWN" as FailureCategory);
    });

    it("a stack frame path containing /db/ does not trigger DATABASE on its own", () => {
      expect(
        categorizeFailure("Something broke", "at query (/src/db/client.ts:8:1)")
      ).toBe("UNKNOWN" as FailureCategory);
    });
  });

  // CQ-131: identifiers are camelCase/PascalCase/SCREAMING_SNAKE_CASE. The
  // token is glued to letters on both sides, so no non-letter-boundary
  // regex can see it — the message must be tokenized on
  // camelCase/acronym boundaries and tested by set membership. These are
  // the 16 real regressions introduced by the `nonLetterBoundary` fix.
  describe("classifies camelCase/PascalCase identifiers via tokenization (CQ-131 regressions)", () => {
    const cases: Array<[string, FailureCategory]> = [
      ["HttpRequestException: call failed", "API"],
      ["HTTPError: bad gateway", "API"],
      ["HTTPSConnectionPool(host='x', port=443): Max retries exceeded", "API"],
      ["HttpResponseException raised", "API"],
      ["ApiException: could not complete", "API"],
      ["ApiError thrown during setup", "API"],
      ["WebApiException occurred", "API"],
      ["RestApiClient failed to respond", "API"],
      ["OpenApiValidationError: schema mismatch", "API"],
      ["GraphQlApiError: resolver threw", "API"],
      ["SoapApiFault: envelope malformed", "API"],
      ["DbUpdateException: save failed", "DATABASE"],
      ["DbContext disposed unexpectedly", "DATABASE"],
      ["DBNull was unexpected here", "DATABASE"],
      ["UIAutomatorBridge disconnected", "UI"],
      ["DomNodeNotFound while querying", "UI"],
    ];

    it.each(cases)("%s -> %s", (message, expected) => {
      expect(categorizeFailure(message, undefined)).toBe(expected as FailureCategory);
    });
  });

  // CQ-131: the fix must not regress the genuine prose improvements the
  // `nonLetterBoundary` attempt made over bare substrings.
  describe("still avoids false positives on words that merely contain a short token (CQ-131)", () => {
    const words = ["guid", "jsdom", "liquid", "squid", "buildkite", "requirement"];

    it.each(words)("'%s' does not misclassify", (word) => {
      expect(categorizeFailure(`Flaky due to ${word} weirdness`, undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });
  });

  // CQ-132: `/expect\(.*\)\.to/` is quadratic in the number of `expect(`
  // occurrences (measured: ~9.7s for a 210KB / 30,000-occurrence
  // adversarial payload, reachable end-to-end via the 50MB JUnit upload
  // route). The fix must complete in well under 100ms.
  describe("does not have quadratic (ReDoS) behavior on adversarial input (CQ-132)", () => {
    it("classifies a 210KB adversarial 'expect(' payload quickly", () => {
      const adversarial = "expect(".repeat(30_000); // ~210KB, no closing paren anywhere
      const start = performance.now();
      const result = categorizeFailure(adversarial, undefined);
      const elapsedMs = performance.now() - start;

      expect(elapsedMs).toBeLessThan(100);
      expect(result).toBe("UNKNOWN" as FailureCategory);
    });

    it("still matches a real expect(...).to assertion", () => {
      expect(categorizeFailure("expect(received).toBe(expected)", undefined)).toBe(
        "ASSERTION" as FailureCategory
      );
    });
  });

  // CQ-133: nearly every assertion-library message contains "expected", so
  // checking ASSERTION first systematically masked more specific root
  // causes. Specific causes must win.
  describe("prefers a specific root cause over the generic ASSERTION bucket (CQ-133)", () => {
    it("'expected 200 but got ECONNREFUSED' is NETWORK, not ASSERTION", () => {
      expect(categorizeFailure("expected 200 but got ECONNREFUSED", undefined)).toBe(
        "NETWORK" as FailureCategory
      );
    });

    it("'expected 1 row, prisma unique constraint failed' is DATABASE, not ASSERTION", () => {
      expect(
        categorizeFailure("expected 1 row, prisma unique constraint failed", undefined)
      ).toBe("DATABASE" as FailureCategory);
    });

    it("'expected element to be visible, test timed out after 30000ms' is TIMEOUT, not ASSERTION", () => {
      expect(
        categorizeFailure(
          "expected element to be visible, test timed out after 30000ms",
          undefined
        )
      ).toBe("TIMEOUT" as FailureCategory);
    });
  });

  // CQ-133: still-raw substring patterns produced real false positives.
  describe("fixes remaining substring false positives (CQ-133)", () => {
    it("'to be' inside 'see photo below' does not trigger ASSERTION", () => {
      expect(categorizeFailure("see photo below", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'to be' inside 'dragged onto bed' does not trigger ASSERTION", () => {
      expect(categorizeFailure("dragged onto bed", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'click' inside 'ClickHouse' does not trigger UI", () => {
      expect(categorizeFailure("ClickHouse connection dropped", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'visible' inside 'record invisible to tenant' does not trigger UI", () => {
      expect(categorizeFailure("record invisible to tenant", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("'expected' inside 'unexpected end of JSON input' does not trigger ASSERTION", () => {
      expect(categorizeFailure("unexpected end of JSON input", undefined)).toBe(
        "UNKNOWN" as FailureCategory
      );
    });

    it("a standalone 'click' still triggers UI", () => {
      expect(categorizeFailure("Error: locator.click failed", undefined)).toBe(
        "UI" as FailureCategory
      );
    });

    it("a standalone 'visible' still triggers UI", () => {
      expect(categorizeFailure("element was not visible", undefined)).toBe(
        "UI" as FailureCategory
      );
    });

    it("a standalone 'expected' still triggers ASSERTION", () => {
      expect(categorizeFailure("expected true, got false", undefined)).toBe(
        "ASSERTION" as FailureCategory
      );
    });
  });
});
