CREATE TYPE "PriceExceptionFollowUpStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'RENEWAL_REQUESTED', 'REPLACEMENT_SUBMITTED', 'NO_RENEWAL_NEEDED', 'COMPLETED');

CREATE TABLE "PriceExceptionFollowUp" (
  "priceExceptionId" INTEGER NOT NULL,
  "status" "PriceExceptionFollowUpStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "ownerId" INTEGER,
  "lastFollowUpAt" TIMESTAMP(3),
  "nextFollowUpAt" DATE,
  "summary" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedById" INTEGER,
  "replacementPriceExceptionId" INTEGER,
  "replacementPeNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceExceptionFollowUp_pkey" PRIMARY KEY ("priceExceptionId")
);

CREATE TABLE "PriceExceptionFollowUpEvent" (
  "id" SERIAL NOT NULL,
  "priceExceptionId" INTEGER NOT NULL,
  "previousValues" JSONB NOT NULL,
  "newValues" JSONB NOT NULL,
  "note" TEXT,
  "actorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceExceptionFollowUpEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceExceptionFollowUp_status_nextFollowUpAt_idx" ON "PriceExceptionFollowUp"("status", "nextFollowUpAt");
CREATE INDEX "PriceExceptionFollowUp_ownerId_idx" ON "PriceExceptionFollowUp"("ownerId");
CREATE INDEX "PriceExceptionFollowUp_replacementPriceExceptionId_idx" ON "PriceExceptionFollowUp"("replacementPriceExceptionId");
CREATE INDEX "PriceExceptionFollowUpEvent_priceExceptionId_createdAt_idx" ON "PriceExceptionFollowUpEvent"("priceExceptionId", "createdAt");

ALTER TABLE "PriceExceptionFollowUp" ADD CONSTRAINT "PriceExceptionFollowUp_priceExceptionId_fkey" FOREIGN KEY ("priceExceptionId") REFERENCES "PriceException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionFollowUp" ADD CONSTRAINT "PriceExceptionFollowUp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionFollowUp" ADD CONSTRAINT "PriceExceptionFollowUp_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionFollowUp" ADD CONSTRAINT "PriceExceptionFollowUp_replacementPriceExceptionId_fkey" FOREIGN KEY ("replacementPriceExceptionId") REFERENCES "PriceException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionFollowUpEvent" ADD CONSTRAINT "PriceExceptionFollowUpEvent_priceExceptionId_fkey" FOREIGN KEY ("priceExceptionId") REFERENCES "PriceExceptionFollowUp"("priceExceptionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionFollowUpEvent" ADD CONSTRAINT "PriceExceptionFollowUpEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
