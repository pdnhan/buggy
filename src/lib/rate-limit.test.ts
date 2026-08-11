import { describe, it, expect } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows requests up to the limit", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000).allowed).toBe(true);
    }
  });

  it("blocks the request once the limit is exceeded", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      rateLimit(key, 5, 60_000);
    }
    const result = rateLimit(key, 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) rateLimit(keyA, 5, 60_000);
    expect(rateLimit(keyA, 5, 60_000).allowed).toBe(false);
    expect(rateLimit(keyB, 5, 60_000).allowed).toBe(true);
  });

  it("resets the count after the window elapses", async () => {
    const key = `reset-${Math.random()}`;
    expect(rateLimit(key, 1, 10).allowed).toBe(true);
    expect(rateLimit(key, 1, 10).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(rateLimit(key, 1, 10).allowed).toBe(true);
  });
});
