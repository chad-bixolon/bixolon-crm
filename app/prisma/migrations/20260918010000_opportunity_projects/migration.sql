CREATE TABLE "OpportunityProject" (
    "opportunityId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpportunityProject_pkey" PRIMARY KEY ("opportunityId","projectId")
);

CREATE INDEX "OpportunityProject_projectId_opportunityId_idx" ON "OpportunityProject"("projectId", "opportunityId");

ALTER TABLE "OpportunityProject" ADD CONSTRAINT "OpportunityProject_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityProject" ADD CONSTRAINT "OpportunityProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OpportunityProject" ("opportunityId", "projectId")
SELECT "id", "projectId" FROM "Opportunity" WHERE "projectId" IS NOT NULL;

DO $$ BEGIN
  IF (SELECT count(*) FROM "OpportunityProject") <> (SELECT count(*) FROM "Opportunity" WHERE "projectId" IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM "Opportunity" o
      WHERE o."projectId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "OpportunityProject" op
        WHERE op."opportunityId" = o.id AND op."projectId" = o."projectId"
      )
    ) THEN
    RAISE EXCEPTION 'OpportunityProject backfill failed: link counts or pairs differ';
  END IF;
END $$;

ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_projectId_fkey";
DROP INDEX "Opportunity_projectId_archivedAt_idx";
ALTER TABLE "Opportunity" DROP COLUMN "projectId";
