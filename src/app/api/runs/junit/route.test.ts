import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    testRun: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/projects", () => ({
  ensureProjectForUser: vi.fn(),
  userCanWriteToProject: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/auth";
import { ensureProjectForUser, userCanWriteToProject } from "@/lib/projects";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockEnsureProject = ensureProjectForUser as ReturnType<typeof vi.fn>;
const mockCanWrite = userCanWriteToProject as ReturnType<typeof vi.fn>;

const session = { user: { id: "user-1" } };

function makeRequest() {
  const formData = new FormData();
  formData.set(
    "file",
    new File(['<testsuite name="s"><testcase name="t"/></testsuite>'], "results.xml", {
      type: "application/xml",
    })
  );
  formData.set("projectId", "p1");
  return new Request("http://localhost/api/runs/junit", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/runs/junit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a VIEWER (closes the VIEWER-write escalation), before parsing the XML", async () => {
    mockAuth.mockResolvedValue(session);
    mockEnsureProject.mockResolvedValue({ id: "p1" });
    mockCanWrite.mockResolvedValue(false);
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });
});
