-- Attribution only; existing immutable rows and all uniqueness/validation triggers remain intact.
ALTER TABLE "OpportunitySnapshotRun" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "ForecastSnapshotRun" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "ForecastSnapshotRun" ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "OpportunitySnapshotRun" ADD CONSTRAINT "OpportunitySnapshotRun_attribution_check"
  CHECK (("source" = 'MANUAL' AND "createdById" IS NOT NULL) OR ("source" = 'SCHEDULED' AND "createdById" IS NULL));
ALTER TABLE "ForecastSnapshotRun" ADD CONSTRAINT "ForecastSnapshotRun_attribution_check"
  CHECK (("source" = 'MANUAL' AND "createdById" IS NOT NULL) OR ("source" = 'SCHEDULED' AND "createdById" IS NULL));

ALTER TABLE "ScheduledJobRun"
  ADD COLUMN "snapshotWeek" DATE,
  ADD COLUMN "opportunitySnapshotRunId" INTEGER,
  ADD COLUMN "forecastSnapshotRunId" INTEGER,
  ADD COLUMN "failureCategory" VARCHAR(40),
  ADD CONSTRAINT "ScheduledJobRun_opportunitySnapshotRunId_fkey" FOREIGN KEY ("opportunitySnapshotRunId") REFERENCES "OpportunitySnapshotRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ScheduledJobRun_forecastSnapshotRunId_fkey" FOREIGN KEY ("forecastSnapshotRunId") REFERENCES "ForecastSnapshotRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
