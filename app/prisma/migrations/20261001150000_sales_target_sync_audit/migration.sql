CREATE TABLE "SalesTargetSync" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "sourceAnnualAmount" DECIMAL(18,2) NOT NULL,
    "priorTargets" JSONB NOT NULL,
    "resultingTargets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesTargetSync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesTargetSync_userId_year_currencyCode_createdAt_idx" ON "SalesTargetSync"("userId", "year", "currencyCode", "createdAt");
CREATE INDEX "SalesTargetSync_planId_idx" ON "SalesTargetSync"("planId");
ALTER TABLE "SalesTargetSync" ADD CONSTRAINT "SalesTargetSync_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesTargetSync" ADD CONSTRAINT "SalesTargetSync_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
