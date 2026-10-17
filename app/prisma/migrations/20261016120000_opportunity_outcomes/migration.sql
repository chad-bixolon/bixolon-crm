-- Additive only: existing Opportunities and snapshots are never backfilled.
CREATE TABLE "OutcomeReason" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "isWon" BOOLEAN NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutcomeReason_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutcomeReason_isWon_name_key" ON "OutcomeReason"("isWon", "name");
CREATE INDEX "OutcomeReason_isWon_active_sortOrder_idx" ON "OutcomeReason"("isWon", "active", "sortOrder");
ALTER TABLE "Opportunity"
  ADD COLUMN "actualCloseDate" DATE,
  ADD COLUMN "outcomeReasonId" INTEGER,
  ADD COLUMN "outcomeReasonName" VARCHAR(200),
  ADD COLUMN "outcomeNotes" VARCHAR(2000);
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_outcomeReasonId_fkey" FOREIGN KEY ("outcomeReasonId") REFERENCES "OutcomeReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Opportunity_actualCloseDate_ownerId_idx" ON "Opportunity"("actualCloseDate", "ownerId");
CREATE INDEX "Opportunity_outcomeReasonId_actualCloseDate_idx" ON "Opportunity"("outcomeReasonId", "actualCloseDate");
ALTER TABLE "OpportunityHistoryEvent" ADD COLUMN "oldOutcome" JSONB, ADD COLUMN "newOutcome" JSONB;
ALTER TABLE "OpportunityHistoryArchive" ADD COLUMN "oldOutcome" JSONB, ADD COLUMN "newOutcome" JSONB;
INSERT INTO "OutcomeReason" ("name", "isWon", "sortOrder", "updatedAt") VALUES
  ('Lost to competitor', false, 0, CURRENT_TIMESTAMP),
  ('Price', false, 10, CURRENT_TIMESTAMP),
  ('Product / feature fit', false, 20, CURRENT_TIMESTAMP),
  ('Customer stayed with incumbent', false, 30, CURRENT_TIMESTAMP),
  ('Project cancelled', false, 40, CURRENT_TIMESTAMP),
  ('Budget unavailable', false, 50, CURRENT_TIMESTAMP),
  ('Project delayed / postponed', false, 60, CURRENT_TIMESTAMP),
  ('No decision', false, 70, CURRENT_TIMESTAMP),
  ('Customer unresponsive', false, 80, CURRENT_TIMESTAMP),
  ('Other', false, 90, CURRENT_TIMESTAMP),
  ('Replaced competitor', true, 0, CURRENT_TIMESTAMP),
  ('New deployment / new business', true, 10, CURRENT_TIMESTAMP),
  ('Existing customer expansion', true, 20, CURRENT_TIMESTAMP),
  ('Product upgrade / replacement', true, 30, CURRENT_TIMESTAMP),
  ('Partner / reseller win', true, 40, CURRENT_TIMESTAMP),
  ('Other', true, 50, CURRENT_TIMESTAMP);
