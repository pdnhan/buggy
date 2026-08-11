-- CQ-111: exploratory_sessions.projectId was a plain scalar column with no
-- FK relation to projects — nothing enforced referential integrity, so a
-- deleted project could leave exploratory sessions orphaned (projectId
-- pointing at a project row that no longer exists).
--
-- REQUIRED PRE-FLIGHT STEP before applying this migration to any existing
-- database (including via `npx prisma db push`, which will also emit this
-- ADD CONSTRAINT and will also fail on orphans):
--   1. Run, BEFORE deploying:
--        SELECT id, "projectId" FROM exploratory_sessions
--        WHERE "projectId" NOT IN (SELECT id FROM projects);
--   2. If that returns any rows, decide what to do with them (reassign to a
--      real project, or accept their deletion) BEFORE this migration runs —
--      the DELETE below is a default "delete the orphans" policy and is
--      NOT reversible. If some of those sessions need to be kept, back them
--      up (e.g. `SELECT * INTO exploratory_sessions_orphan_backup FROM ...`)
--      first and adjust this migration to reassign instead of delete.
--
-- Unverified against a real database — there is no live Postgres instance
-- available in this environment to actually run/rehearse this migration.

-- Orphan cleanup: delete exploratory_sessions rows whose projectId no
-- longer references an existing project. Without this, the ADD CONSTRAINT
-- below fails outright on any pre-existing orphan and the whole deploy
-- (docker-compose's `migrate`/app startup) fails with it.
DELETE FROM "exploratory_sessions"
WHERE "projectId" NOT IN (SELECT "id" FROM "projects");

-- DropIndex
DROP INDEX "api_keys_keyHash_idx";

-- DropIndex
DROP INDEX "bugs_status_idx";

-- DropIndex
DROP INDEX "bugs_severity_idx";

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE INDEX "bugs_projectId_status_idx" ON "bugs"("projectId", "status");

-- CreateIndex
CREATE INDEX "bugs_projectId_severity_idx" ON "bugs"("projectId", "severity");

-- AddForeignKey
ALTER TABLE "exploratory_sessions" ADD CONSTRAINT "exploratory_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
