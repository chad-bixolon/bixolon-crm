CREATE TABLE "CompetitorOption" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompetitorOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompetitorOption_name_key" ON "CompetitorOption"("name");
CREATE UNIQUE INDEX "CompetitorOption_name_ci_key" ON "CompetitorOption"(lower("name"));
CREATE INDEX "CompetitorOption_active_sortOrder_idx" ON "CompetitorOption"("active", "sortOrder");

ALTER TABLE "Opportunity" ADD COLUMN "competitorId" INTEGER,
ADD COLUMN "currentProductBeingUsed" TEXT,
ADD COLUMN "customerPainPoints" TEXT;

CREATE INDEX "Opportunity_competitorId_idx" ON "Opportunity"("competitorId");
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "CompetitorOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
