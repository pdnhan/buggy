-- CreateEnum
CREATE TYPE "BugSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "BugPriority" AS ENUM ('HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST');

-- CreateEnum
CREATE TYPE "BugStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'READY_FOR_QA', 'IN_QA', 'FIXED', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED', 'DUPLICATE', 'CANNOT_REPRODUCE', 'DEFERRED');

-- CreateEnum
CREATE TYPE "DetectionSource" AS ENUM ('QA', 'DEVELOPER', 'INTERNAL_STAKEHOLDER', 'CLIENT', 'UAT_TESTER', 'END_USER', 'MONITORING_SYSTEM', 'SUPPORT_TEAM', 'PRODUCTION_OPERATIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "DetectionPhase" AS ENUM ('DEVELOPMENT', 'CODE_REVIEW', 'UNIT_TESTING', 'INTEGRATION_TESTING', 'QA', 'REGRESSION_TESTING', 'STAGING', 'UAT', 'CLIENT_ACCEPTANCE', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "RootCause" AS ENUM ('REQUIREMENT_MISUNDERSTANDING', 'MISSING_REQUIREMENT', 'INCORRECT_BUSINESS_LOGIC', 'VALIDATION_ISSUE', 'UI_IMPLEMENTATION_ISSUE', 'API_ISSUE', 'INTEGRATION_ISSUE', 'DATABASE_ISSUE', 'PERFORMANCE_ISSUE', 'SECURITY_ISSUE', 'ENVIRONMENT_ISSUE', 'DEPLOYMENT_ISSUE', 'CONFIGURATION_ISSUE', 'REGRESSION', 'MISSING_TEST_CASE', 'INCOMPLETE_TEST_COVERAGE', 'HUMAN_ERROR', 'THIRD_PARTY_DEPENDENCY', 'DATA_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReopenReason" AS ENUM ('FIX_DID_NOT_RESOLVE', 'ISSUE_STILL_REPRODUCIBLE', 'PARTIAL_FIX', 'ACCEPTANCE_CRITERIA_NOT_MET', 'REGRESSION_CAUSED_BY_FIX', 'DIFFERENT_SCENARIO_STILL_AFFECTED', 'INCORRECT_DEPLOYMENT', 'FIX_MISSING_FROM_RELEASE', 'ENVIRONMENT_MISMATCH', 'INSUFFICIENT_TEST_EVIDENCE', 'OTHER');

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "enableBugTracking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "bugCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "bugs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleId" TEXT,
    "displayId" TEXT NOT NULL,
    "externalIssueId" TEXT,
    "issueTrackerUrl" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "sprint" TEXT,
    "release" TEXT,
    "fixVersion" TEXT,
    "severity" "BugSeverity" NOT NULL,
    "priority" "BugPriority" NOT NULL DEFAULT 'MEDIUM',
    "bugType" TEXT,
    "rootCause" "RootCause",
    "detectionSource" "DetectionSource" NOT NULL DEFAULT 'QA',
    "detectionPhase" "DetectionPhase" NOT NULL,
    "environment" TEXT,
    "isRegression" BOOLEAN NOT NULL DEFAULT false,
    "isLeaked" BOOLEAN NOT NULL DEFAULT false,
    "leakageOverridden" BOOLEAN NOT NULL DEFAULT false,
    "leakageOverrideReason" TEXT,
    "assignedDeveloperId" TEXT,
    "responsibleQaId" TEXT,
    "reporterId" TEXT NOT NULL,
    "status" "BugStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstDetectedDate" TIMESTAMP(3),
    "firstFixedDate" TIMESTAMP(3),
    "lastFixedDate" TIMESTAMP(3),
    "closedDate" TIMESTAMP(3),
    "firstReopenedDate" TIMESTAMP(3),
    "lastReopenedDate" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "clientImpact" TEXT,
    "businessImpact" TEXT,
    "reproductionSteps" TEXT,
    "expectedResult" TEXT,
    "actualResult" TEXT,
    "notes" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "bugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reopen_events" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "previousStatus" "BugStatus" NOT NULL,
    "newStatus" "BugStatus" NOT NULL,
    "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedById" TEXT NOT NULL,
    "reason" "ReopenReason" NOT NULL,
    "environment" TEXT,
    "releaseOrBuild" TEXT,
    "assignedDeveloperId" TEXT,
    "responsibleQaId" TEXT,
    "comment" TEXT,

    CONSTRAINT "reopen_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bugs_projectId_idx" ON "bugs"("projectId");

-- CreateIndex
CREATE INDEX "bugs_moduleId_idx" ON "bugs"("moduleId");

-- CreateIndex
CREATE INDEX "bugs_projectId_createdAt_idx" ON "bugs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "bugs_status_idx" ON "bugs"("status");

-- CreateIndex
CREATE INDEX "bugs_severity_idx" ON "bugs"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "bugs_projectId_displayId_key" ON "bugs"("projectId", "displayId");

-- CreateIndex
CREATE INDEX "reopen_events_bugId_idx" ON "reopen_events"("bugId");

-- CreateIndex
CREATE UNIQUE INDEX "reopen_events_bugId_sequenceNumber_key" ON "reopen_events"("bugId", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_assignedDeveloperId_fkey" FOREIGN KEY ("assignedDeveloperId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_responsibleQaId_fkey" FOREIGN KEY ("responsibleQaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reopen_events" ADD CONSTRAINT "reopen_events_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bugs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reopen_events" ADD CONSTRAINT "reopen_events_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reopen_events" ADD CONSTRAINT "reopen_events_assignedDeveloperId_fkey" FOREIGN KEY ("assignedDeveloperId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reopen_events" ADD CONSTRAINT "reopen_events_responsibleQaId_fkey" FOREIGN KEY ("responsibleQaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
