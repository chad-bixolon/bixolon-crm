-- Extend the existing job ledger; snapshot rows remain authoritative and untouched.
ALTER TABLE "ScheduledJobRun"
  ADD COLUMN "operation" VARCHAR(40),
  ADD COLUMN "contextKey" VARCHAR(64),
  ADD COLUMN "actorId" INTEGER,
  ADD COLUMN "serviceIdentity" VARCHAR(40),
  ADD COLUMN "supportCaseId" INTEGER,
  ADD COLUMN "calendarConnectionId" INTEGER,
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ScheduledJobRun_jobType_operation_contextKey_status_startedAt_idx" ON "ScheduledJobRun"("jobType", "operation", "contextKey", "status", "startedAt");
CREATE INDEX "ScheduledJobRun_startedAt_id_idx" ON "ScheduledJobRun"("startedAt" DESC, "id" DESC);
