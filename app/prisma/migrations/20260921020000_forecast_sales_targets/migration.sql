CREATE TYPE "SalesQuarter" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

-- Preserve explicit open classifications. A closed stage always determines its
-- non-open classification; no historical row is assigned COMMIT or BEST_CASE.
UPDATE "Opportunity" o SET "forecastCategory" = CASE
  WHEN s."isWon" THEN 'CLOSED'::"ForecastCategory"
  ELSE 'OMITTED'::"ForecastCategory" END
FROM "SalesStage" s
WHERE o."stageId" = s.id AND s."isClosed" = true
  AND o."forecastCategory" IS DISTINCT FROM
    (CASE WHEN s."isWon" THEN 'CLOSED'::"ForecastCategory" ELSE 'OMITTED'::"ForecastCategory" END);

UPDATE "Opportunity" o SET "forecastCategory" = 'PIPELINE'::"ForecastCategory"
FROM "SalesStage" s
WHERE o."stageId" = s.id AND s."isClosed" = false
  AND (o."forecastCategory" IS NULL OR o."forecastCategory" = 'CLOSED');

ALTER TABLE "Opportunity" ALTER COLUMN "forecastCategory" SET DEFAULT 'PIPELINE';
ALTER TABLE "Opportunity" ALTER COLUMN "forecastCategory" SET NOT NULL;
CREATE INDEX "Opportunity_ownerId_expectedCloseDate_currencyCode_idx" ON "Opportunity"("ownerId", "expectedCloseDate", "currencyCode");

CREATE TABLE "SalesTarget" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "quarter" "SalesQuarter" NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "targetAmount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdById" INTEGER NOT NULL,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesTarget_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "SalesTarget_amount_check" CHECK ("targetAmount" >= 0)
);
CREATE INDEX "SalesTarget_userId_year_quarter_currencyCode_archivedAt_idx" ON "SalesTarget"("userId", "year", "quarter", "currencyCode", "archivedAt");
CREATE INDEX "SalesTarget_year_quarter_currencyCode_archivedAt_idx" ON "SalesTarget"("year", "quarter", "currencyCode", "archivedAt");
CREATE UNIQUE INDEX "SalesTarget_active_identity_key" ON "SalesTarget"("userId", "year", "quarter", "currencyCode") WHERE "archivedAt" IS NULL;
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
