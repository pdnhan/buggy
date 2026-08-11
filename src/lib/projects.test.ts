import { describe, it, expect, vi, beforeEach } from "vitest";

// projects.ts talks to the DB exclusively through `db` from "@/lib/db" — mock
// it so every predicate here is exercised as a pure function of what
// `projectMember.findUnique` (or `findFirst`/`user.findUnique`) resolves to.
vi.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    project: {
      create: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  ensureProjectForUser,
  getUserProjects,
  createProject,
  userIsProjectAdmin,
  getProjectRole,
  userHasProjectAccess,
  userCanWriteToProject,
} from "./projects";

const mockDb = db as unknown as {
  projectMember: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  project: { create: ReturnType<typeof vi.fn> };
};

const userId = "user-1";
const projectId = "proj-1";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── userCanWriteToProject ──────────────────────────────────────────────────
// Gates every write route (13 of them). ADMIN and MEMBER may write; VIEWER
// and non-members may not. The VIEWER case is the load-bearing one — it is
// the entire difference between the correct predicate and the regression
// `return role !== null`, which would readmit VIEWER to every write route.

describe("userCanWriteToProject", () => {
  it("returns true for ADMIN", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await userCanWriteToProject(userId, projectId)).toBe(true);
  });

  it("returns true for MEMBER", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    expect(await userCanWriteToProject(userId, projectId)).toBe(true);
  });

  it("returns false for VIEWER (load-bearing: VIEWER must not write)", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await userCanWriteToProject(userId, projectId)).toBe(false);
  });

  it("returns false for a non-member", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue(null);
    expect(await userCanWriteToProject(userId, projectId)).toBe(false);
  });
});

// ─── userIsProjectAdmin ─────────────────────────────────────────────────────
// Gates admin-only routes (API key minting/revocation, member management).
// The MEMBER case is load-bearing — it is the entire difference between the
// correct predicate and the regression `return member !== null`, which would
// let any project member (not just ADMIN) reach admin-only routes.

describe("userIsProjectAdmin", () => {
  it("returns true for ADMIN", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await userIsProjectAdmin(userId, projectId)).toBe(true);
  });

  it("returns false for MEMBER (load-bearing: MEMBER must not be treated as admin)", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    expect(await userIsProjectAdmin(userId, projectId)).toBe(false);
  });

  it("returns false for VIEWER", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await userIsProjectAdmin(userId, projectId)).toBe(false);
  });

  it("returns false for a non-member", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue(null);
    expect(await userIsProjectAdmin(userId, projectId)).toBe(false);
  });
});

// ─── getProjectRole ─────────────────────────────────────────────────────────
// The raw role lookup that userCanWriteToProject and several routes (e.g.
// POST /api/bugs) build their own finer-grained checks on top of.

describe("getProjectRole", () => {
  it("returns ADMIN", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await getProjectRole(userId, projectId)).toBe("ADMIN");
  });

  it("returns MEMBER", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    expect(await getProjectRole(userId, projectId)).toBe("MEMBER");
  });

  it("returns VIEWER", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await getProjectRole(userId, projectId)).toBe("VIEWER");
  });

  it("returns null for a non-member", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue(null);
    expect(await getProjectRole(userId, projectId)).toBeNull();
  });
});

// ─── userHasProjectAccess ───────────────────────────────────────────────────
// The membership-only check appropriate for reads. VIEWER counts as access
// here (unlike userCanWriteToProject) — that asymmetry is the whole point of
// the two predicates existing separately.

describe("userHasProjectAccess", () => {
  it("returns true for ADMIN", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "ADMIN" });
    expect(await userHasProjectAccess(userId, projectId)).toBe(true);
  });

  it("returns true for MEMBER", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    expect(await userHasProjectAccess(userId, projectId)).toBe(true);
  });

  it("returns true for VIEWER (mere membership is enough to read)", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await userHasProjectAccess(userId, projectId)).toBe(true);
  });

  it("returns false for a non-member", async () => {
    mockDb.projectMember.findUnique.mockResolvedValue(null);
    expect(await userHasProjectAccess(userId, projectId)).toBe(false);
  });
});

// ─── ensureProjectForUser ───────────────────────────────────────────────────

describe("ensureProjectForUser", () => {
  it("returns the existing project when the user already has a membership", async () => {
    const existingProject = { id: projectId, name: "Existing" };
    mockDb.projectMember.findFirst.mockResolvedValue({ project: existingProject });

    const result = await ensureProjectForUser(userId);

    expect(result).toEqual(existingProject);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb.project.create).not.toHaveBeenCalled();
  });

  it("returns null for a missing user instead of crashing (stale session)", async () => {
    mockDb.projectMember.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await ensureProjectForUser(userId);

    expect(result).toBeNull();
    expect(mockDb.project.create).not.toHaveBeenCalled();
  });

  it("creates a default project for a first-time user, deriving name and slug from their name", async () => {
    mockDb.projectMember.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue({ id: userId, name: "Jane Doe", email: "jane@example.com" });
    mockDb.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-project",
      ...data,
    }));

    const result = await ensureProjectForUser(userId);

    expect(mockDb.project.create).toHaveBeenCalledTimes(1);
    const createArgs = mockDb.project.create.mock.calls[0][0];
    expect(createArgs.data.name).toBe("Jane's Project");
    // slugify lowercases, turns runs of non-alphanumerics into a single "-",
    // and trims leading/trailing "-"; "Jane's Project" -> "jane-s-project".
    expect(createArgs.data.slug).toMatch(/^jane-s-project-[a-f0-9]{8}$/);
    expect(createArgs.data.members.create).toEqual({ userId, role: "ADMIN" });
    expect(result).toMatchObject({ name: "Jane's Project" });
  });

  it("falls back to 'My Project' when the user has no usable name", async () => {
    mockDb.projectMember.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue({ id: userId, name: "   ", email: "a@b.com" });
    mockDb.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-project",
      ...data,
    }));

    await ensureProjectForUser(userId);

    const createArgs = mockDb.project.create.mock.calls[0][0];
    expect(createArgs.data.name).toBe("My Project");
    expect(createArgs.data.slug).toMatch(/^my-project-[a-f0-9]{8}$/);
  });

  it("re-throws on unexpected DB errors rather than swallowing them", async () => {
    mockDb.projectMember.findFirst.mockRejectedValue(new Error("connection lost"));
    await expect(ensureProjectForUser(userId)).rejects.toThrow("connection lost");
  });
});

// ─── getUserProjects ────────────────────────────────────────────────────────

describe("getUserProjects", () => {
  it("annotates each project with the caller's role from the membership", async () => {
    mockDb.projectMember.findMany.mockResolvedValue([
      { role: "ADMIN", project: { id: "p1", name: "One" } },
      { role: "VIEWER", project: { id: "p2", name: "Two" } },
    ]);

    const result = await getUserProjects(userId);

    expect(result).toEqual([
      { id: "p1", name: "One", role: "ADMIN" },
      { id: "p2", name: "Two", role: "VIEWER" },
    ]);
  });
});

// ─── createProject ──────────────────────────────────────────────────────────

describe("createProject", () => {
  it("creates the caller as ADMIN, trims the name, and derives a prefix from initials when none is supplied", async () => {
    mockDb.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-project",
      ...data,
    }));

    await createProject(userId, { name: "  Quality Assurance  " });

    const createArgs = mockDb.project.create.mock.calls[0][0];
    expect(createArgs.data.name).toBe("Quality Assurance");
    expect(createArgs.data.testCasePrefix).toBe("QA");
    expect(createArgs.data.members.create).toEqual({ userId, role: "ADMIN" });
  });

  it("sanitizes a caller-supplied prefix instead of deriving one", async () => {
    mockDb.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-project",
      ...data,
    }));

    await createProject(userId, { name: "Quality Assurance", initials: "wa!ck-y#1" });

    const createArgs = mockDb.project.create.mock.calls[0][0];
    // sanitizeTestCasePrefix uppercases, strips non-alphanumerics, caps at 6.
    expect(createArgs.data.testCasePrefix).toBe("WACKY1");
  });

  it("stores null description when none is supplied", async () => {
    mockDb.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-project",
      ...data,
    }));

    await createProject(userId, { name: "No Description" });

    const createArgs = mockDb.project.create.mock.calls[0][0];
    expect(createArgs.data.description).toBeNull();
  });
});
