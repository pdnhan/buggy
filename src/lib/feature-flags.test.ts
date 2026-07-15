import { describe, it, expect, vi, beforeEach } from "vitest";

// Bypass React.cache() so the function is called fresh every time in tests
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});

vi.mock("@/lib/db", () => ({
  db: {
    workspaceSettings: {
      findFirst: vi.fn(),
    },
  },
}));

import { getFeatureFlags } from "./feature-flags";
import { db } from "./db";

const mockDb = db as unknown as {
  workspaceSettings: { findFirst: ReturnType<typeof vi.fn> };
};

describe("getFeatureFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_SESSION_TESTING;
    delete process.env.ENABLE_RELEASE_TRACKING;
    delete process.env.ENABLE_BUG_TRACKING;
  });

  it("returns DB values when a settings row exists", async () => {
    mockDb.workspaceSettings.findFirst.mockResolvedValue({
      enableSessionTesting: true,
      enableReleaseTracking: false,
      openRegistration: true,
      enableBugTracking: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flags = await (getFeatureFlags as any)();
    expect(flags).toEqual({
      enableSessionTesting: true,
      enableReleaseTracking: false,
      openRegistration: true,
      enableBugTracking: true,
    });
  });

  it("falls back to env vars when no settings row", async () => {
    mockDb.workspaceSettings.findFirst.mockResolvedValue(null);
    process.env.ENABLE_SESSION_TESTING = "true";
    process.env.ENABLE_RELEASE_TRACKING = "true";
    process.env.ENABLE_BUG_TRACKING = "true";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flags = await (getFeatureFlags as any)();
    expect(flags.enableSessionTesting).toBe(true);
    expect(flags.enableReleaseTracking).toBe(true);
    expect(flags.openRegistration).toBe(false); // no env var for this one
    expect(flags.enableBugTracking).toBe(true);
  });

  it("returns all false defaults when no settings row and no env vars", async () => {
    mockDb.workspaceSettings.findFirst.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flags = await (getFeatureFlags as any)();
    expect(flags).toEqual({
      enableSessionTesting: false,
      enableReleaseTracking: false,
      openRegistration: false,
      enableBugTracking: false,
    });
  });
});
