ALTER TABLE "SupportCase" ADD COLUMN "purchaseSourceText" TEXT,
ADD COLUMN "purchasedFromAccountId" INTEGER;

CREATE INDEX "SupportCase_purchasedFromAccountId_idx" ON "SupportCase"("purchasedFromAccountId");

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_purchasedFromAccountId_fkey" FOREIGN KEY ("purchasedFromAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
