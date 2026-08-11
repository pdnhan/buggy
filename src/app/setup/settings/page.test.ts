import { describe, it, expect, vi, beforeEach } from "vitest";

// CQ-124: src/proxy.ts's middleware lock on /setup/settings is
// belt-and-suspenders — the AUTHORITATIVE check is the auth()+redirect()
// gate inside this server component itself (see the comment at the top of
// page.tsx). A mutant that removes either the isWorkspaceAdmin redirect or
// the whole auth() block entirely was surviving because nothing exercised
// this component directly; the middleware test alone can't catch it since
// it tests a different file.

const mockRedirect = vi.fn((url: string) => {
  // Mirrors next/navigation's real redirect(): it throws to interrupt
  // rendering, so callers of the page component never fall through to the
  // JSX below the redirect call.
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("./settings-form", () => ({
  SetupSettingsForm: () => "SetupSettingsForm",
}));

import SetupSettingsPage from "./page";
import { auth } from "@/auth";

const mockAuth = auth as ReturnType<typeof vi.fn>;

describe("SetupSettingsPage (server component gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
  });

  it("redirects to /login when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(SetupSettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /dashboard when the authenticated user is not a workspace admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isWorkspaceAdmin: false } });
    await expect(SetupSettingsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the settings form (does not redirect) for a workspace admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", isWorkspaceAdmin: true } });
    const result = await SetupSettingsPage();
    expect(mockRedirect).not.toHaveBeenCalled();
    // The returned element is the mocked SetupSettingsForm, proving the
    // gate let execution fall through to the actual page body.
    expect(result).toBeTruthy();
    expect(result.type).toBeDefined();
  });
});
