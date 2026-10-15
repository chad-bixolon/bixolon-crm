CREATE TABLE "OpportunitySnapshotRun" (
  "id" SERIAL PRIMARY KEY,
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "snapshotWeek" DATE NOT NULL,
  "createdById" INTEGER NOT NULL,
  "createdByName" TEXT NOT NULL,
  "opportunityCount" INTEGER NOT NULL CHECK ("opportunityCount" >= 0),
  "status" VARCHAR(16) NOT NULL DEFAULT 'COMPLETE' CHECK ("status" = 'COMPLETE'),
  "source" VARCHAR(16) NOT NULL DEFAULT 'MANUAL' CHECK ("source" IN ('MANUAL', 'SCHEDULED')),
  "scopeVersion" VARCHAR(32) NOT NULL DEFAULT 'OPEN_OPERATIONAL_V1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OpportunitySnapshotRun_snapshotWeek_key" ON "OpportunitySnapshotRun"("snapshotWeek");
CREATE INDEX "OpportunitySnapshotRun_snapshotAt_id_idx" ON "OpportunitySnapshotRun"("snapshotAt", "id");

CREATE TABLE "OpportunitySnapshot" (
  "id" SERIAL PRIMARY KEY,
  "runId" INTEGER NOT NULL REFERENCES "OpportunitySnapshotRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "opportunityId" INTEGER NOT NULL,
  "opportunityName" TEXT NOT NULL,
  "accountIds" INTEGER[] NOT NULL,
  "accounts" JSONB NOT NULL CHECK (jsonb_typeof("accounts") = 'array'),
  "ownerId" INTEGER,
  "ownerName" TEXT,
  "stageId" INTEGER NOT NULL,
  "stageName" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "expectedCloseDate" TIMESTAMP(3),
  "probability" INTEGER NOT NULL CHECK ("probability" BETWEEN 0 AND 100),
  "probabilityOverride" INTEGER,
  "stageProbability" INTEGER NOT NULL,
  "forecastCategory" "ForecastCategory" NOT NULL,
  "status" VARCHAR(8) NOT NULL CHECK ("status" IN ('OPEN', 'WON', 'LOST')),
  "productCount" INTEGER NOT NULL CHECK ("productCount" >= 0)
);
CREATE UNIQUE INDEX "OpportunitySnapshot_runId_opportunityId_key" ON "OpportunitySnapshot"("runId", "opportunityId");
CREATE INDEX "OpportunitySnapshot_opportunityId_snapshotAt_idx" ON "OpportunitySnapshot"("opportunityId", "snapshotAt");
CREATE INDEX "OpportunitySnapshot_ownerId_runId_idx" ON "OpportunitySnapshot"("ownerId", "runId");
CREATE INDEX "OpportunitySnapshot_stageId_runId_idx" ON "OpportunitySnapshot"("stageId", "runId");
CREATE INDEX "OpportunitySnapshot_snapshotAt_idx" ON "OpportunitySnapshot"("snapshotAt");
CREATE INDEX "OpportunitySnapshot_accountIds_idx" ON "OpportunitySnapshot" USING GIN ("accountIds");

CREATE FUNCTION reject_opportunity_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity snapshots are immutable';
END;
$$;
CREATE TRIGGER opportunity_snapshot_immutable BEFORE UPDATE OR DELETE ON "OpportunitySnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_opportunity_snapshot_mutation();
CREATE TRIGGER opportunity_snapshot_no_truncate BEFORE TRUNCATE ON "OpportunitySnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_opportunity_snapshot_mutation();
CREATE TRIGGER opportunity_snapshot_run_immutable BEFORE UPDATE OR DELETE ON "OpportunitySnapshotRun"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_opportunity_snapshot_mutation();
CREATE TRIGGER opportunity_snapshot_run_no_truncate BEFORE TRUNCATE ON "OpportunitySnapshotRun"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_opportunity_snapshot_mutation();

-- A committed run cannot be extended. Its rows must be inserted in the same
-- transaction as its parent, and must agree with the parent's snapshot timestamp.
CREATE FUNCTION validate_opportunity_snapshot_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "OpportunitySnapshotRun" r
    WHERE r.id = NEW."runId" AND r."snapshotAt" = NEW."snapshotAt"
      AND r.xmin::text = (pg_current_xact_id()::text::numeric % 4294967296)::text) THEN
    RAISE EXCEPTION 'Snapshot rows must be created atomically with their run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER opportunity_snapshot_validate_insert BEFORE INSERT ON "OpportunitySnapshot"
  FOR EACH ROW EXECUTE FUNCTION validate_opportunity_snapshot_insert();

CREATE FUNCTION validate_opportunity_snapshot_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "OpportunitySnapshot" WHERE "runId" = NEW.id) <> NEW."opportunityCount" THEN
    RAISE EXCEPTION 'Opportunity snapshot run count mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER opportunity_snapshot_run_complete AFTER INSERT ON "OpportunitySnapshotRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_opportunity_snapshot_run();
