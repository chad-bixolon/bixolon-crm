-- Forward only: old source rows retain unknown eligibility; old forecast tables
-- and their archive workflows are deliberately untouched.
ALTER TABLE "OpportunitySnapshot" ADD COLUMN "ownerForecastEligible" BOOLEAN;
CREATE INDEX "OpportunitySnapshot_runId_close_currency_category_idx" ON "OpportunitySnapshot" ("runId", "expectedCloseDate", "currencyCode", "forecastCategory");

CREATE TABLE "ForecastSnapshotRun" (
  id SERIAL PRIMARY KEY,
  "sourceRunId" INTEGER NOT NULL REFERENCES "OpportunitySnapshotRun"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" INTEGER NOT NULL,
  "createdByName" TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  quarter "SalesQuarter" NOT NULL,
  "opportunityCount" INTEGER NOT NULL CHECK ("opportunityCount" >= 0),
  "salespersonCount" INTEGER NOT NULL CHECK ("salespersonCount" >= 0),
  "rowCount" INTEGER NOT NULL CHECK ("rowCount" >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETE' CHECK (status = 'COMPLETE'),
  "rulesVersion" VARCHAR(32) NOT NULL DEFAULT 'QUARTERLY_V1' CHECK ("rulesVersion" = 'QUARTERLY_V1')
);
CREATE UNIQUE INDEX "ForecastSnapshotRun_sourceRunId_year_quarter_key" ON "ForecastSnapshotRun"("sourceRunId", year, quarter);
CREATE INDEX "ForecastSnapshotRun_year_quarter_snapshotAt_idx" ON "ForecastSnapshotRun"(year, quarter, "snapshotAt");
CREATE INDEX "ForecastSnapshotRun_snapshotAt_id_idx" ON "ForecastSnapshotRun"("snapshotAt", id);
CREATE TABLE "ForecastSnapshotRollup" (
  id SERIAL PRIMARY KEY,
  "runId" INTEGER NOT NULL REFERENCES "ForecastSnapshotRun"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "ownerId" INTEGER NOT NULL,
  "ownerName" TEXT NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "forecastCategory" "ForecastCategory" NOT NULL CHECK ("forecastCategory" IN ('PIPELINE', 'BEST_CASE', 'COMMIT', 'CLOSED')),
  "categoryName" TEXT NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  "opportunityCount" INTEGER NOT NULL CHECK ("opportunityCount" > 0)
);
CREATE UNIQUE INDEX "ForecastSnapshotRollup_group_key" ON "ForecastSnapshotRollup"("runId", "ownerId", "currencyCode", "forecastCategory");
CREATE INDEX "ForecastSnapshotRollup_ownerId_runId_idx" ON "ForecastSnapshotRollup"("ownerId", "runId");
CREATE INDEX "ForecastSnapshotRollup_currencyCode_forecastCategory_runId_idx" ON "ForecastSnapshotRollup"("currencyCode", "forecastCategory", "runId");

CREATE FUNCTION reject_forecast_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Forecast snapshots are immutable'; END;
$$;
CREATE TRIGGER forecast_run_immutable BEFORE UPDATE OR DELETE ON "ForecastSnapshotRun" FOR EACH STATEMENT EXECUTE FUNCTION reject_forecast_snapshot_mutation();
CREATE TRIGGER forecast_run_no_truncate BEFORE TRUNCATE ON "ForecastSnapshotRun" FOR EACH STATEMENT EXECUTE FUNCTION reject_forecast_snapshot_mutation();
CREATE TRIGGER forecast_rollup_immutable BEFORE UPDATE OR DELETE ON "ForecastSnapshotRollup" FOR EACH STATEMENT EXECUTE FUNCTION reject_forecast_snapshot_mutation();
CREATE TRIGGER forecast_rollup_no_truncate BEFORE TRUNCATE ON "ForecastSnapshotRollup" FOR EACH STATEMENT EXECUTE FUNCTION reject_forecast_snapshot_mutation();
CREATE FUNCTION validate_forecast_rollup_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ForecastSnapshotRun" r WHERE r.id = NEW."runId"
    AND r.xmin::text = (pg_current_xact_id()::text::numeric % 4294967296)::text) THEN
    RAISE EXCEPTION 'Forecast rows must be created atomically with their run';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER forecast_rollup_insert BEFORE INSERT ON "ForecastSnapshotRollup" FOR EACH ROW EXECUTE FUNCTION validate_forecast_rollup_insert();

CREATE FUNCTION validate_forecast_snapshot_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_start TIMESTAMP; period_end TIMESTAMP;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "OpportunitySnapshotRun" s WHERE s.id = NEW."sourceRunId"
    AND s.status = 'COMPLETE' AND s."scopeVersion" = 'FORECAST_OPERATIONAL_V1' AND s."snapshotAt" = NEW."snapshotAt") THEN
    RAISE EXCEPTION 'A compatible source Opportunity Snapshot Run is required';
  END IF;
  period_start := make_date(NEW.year, (substring(NEW.quarter::text, 2)::int - 1) * 3 + 1, 1)::timestamp;
  period_end := period_start + interval '3 months';
  IF (SELECT count(*) FROM "ForecastSnapshotRollup" WHERE "runId" = NEW.id) <> NEW."rowCount"
    OR (SELECT count(DISTINCT "ownerId") FROM "ForecastSnapshotRollup" WHERE "runId" = NEW.id) <> NEW."salespersonCount"
    OR (SELECT COALESCE(sum("opportunityCount"), 0) FROM "ForecastSnapshotRollup" WHERE "runId" = NEW.id) <> NEW."opportunityCount" THEN
    RAISE EXCEPTION 'Forecast snapshot run count mismatch';
  END IF;
  -- Validate exact category amounts, counts and preserved display names against
  -- the source. Bidirectional EXCEPT also catches missing and invented groups.
  IF EXISTS (
    WITH expected AS (
      SELECT "ownerId", min("ownerName") AS "ownerName", "currencyCode", "forecastCategory",
        CASE "forecastCategory" WHEN 'PIPELINE' THEN 'Pipeline' WHEN 'BEST_CASE' THEN 'Best Case' WHEN 'COMMIT' THEN 'Commit' ELSE 'Closed Won' END AS "categoryName",
        sum(amount) AS amount, count(*) AS "opportunityCount"
      FROM (
        SELECT "ownerId", "ownerName", "currencyCode", amount,
          CASE WHEN status = 'WON' THEN 'CLOSED'::"ForecastCategory" ELSE "forecastCategory" END AS "forecastCategory"
        FROM "OpportunitySnapshot" WHERE "runId" = NEW."sourceRunId"
          AND "ownerForecastEligible" = true AND "ownerId" IS NOT NULL AND "ownerName" IS NOT NULL
          AND "expectedCloseDate" >= period_start AND "expectedCloseDate" < period_end
          AND ((status = 'OPEN' AND "forecastCategory" IN ('PIPELINE', 'BEST_CASE', 'COMMIT')) OR status = 'WON')
      ) normalized GROUP BY "ownerId", "currencyCode", "forecastCategory"
    ), actual AS (
      SELECT "ownerId", "ownerName", "currencyCode", "forecastCategory", "categoryName", amount, "opportunityCount"::bigint
      FROM "ForecastSnapshotRollup" WHERE "runId" = NEW.id
    ) SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) difference
  ) THEN RAISE EXCEPTION 'Forecast rollups do not match their source snapshots'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER forecast_run_complete AFTER INSERT ON "ForecastSnapshotRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_forecast_snapshot_run();
