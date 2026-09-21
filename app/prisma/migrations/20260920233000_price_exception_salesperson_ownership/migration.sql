ALTER TABLE "PriceException"
  ADD COLUMN "sourceSalesRepName" TEXT,
  ADD COLUMN "sourceSalesRepEmail" TEXT,
  ADD COLUMN "assignedSalesRepUserId" INTEGER;

CREATE INDEX "PriceException_assignedSalesRepUserId_idx"
  ON "PriceException"("assignedSalesRepUserId");

ALTER TABLE "PriceException"
  ADD CONSTRAINT "PriceException_assignedSalesRepUserId_fkey"
  FOREIGN KEY ("assignedSalesRepUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
