ALTER TYPE "OpportunityProductPriceSource" ADD VALUE 'ODM_CUSTOMER';
CREATE TYPE "OdmCustomerPriceSource" AS ENUM ('MANUAL', 'GARY_WORKBOOK');

ALTER TABLE "ProductSkuOdmCustomer" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "ProductSkuOdmCustomerPrice" (
  "id" SERIAL NOT NULL,
  "skuId" INTEGER NOT NULL,
  "accountId" INTEGER NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "customerPrice" DECIMAL(12,2) NOT NULL,
  "previousPrice" DECIMAL(12,2),
  "tariffPercent" DECIMAL(9,4) NOT NULL,
  "tariffAmount" DECIMAL(12,2) NOT NULL,
  "finalUnitPrice" DECIMAL(12,2) NOT NULL,
  "effectiveDate" DATE,
  "notes" TEXT,
  "sourceType" "OdmCustomerPriceSource" NOT NULL,
  "sourceMetadata" JSONB,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSkuOdmCustomerPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSkuOdmCustomerPrice_amount_check" CHECK (
    "customerPrice" >= 0 AND ("previousPrice" IS NULL OR "previousPrice" >= 0)
    AND "tariffPercent" >= 0 AND "tariffAmount" >= 0
    AND "finalUnitPrice" = "customerPrice" + "tariffAmount"
  )
);
CREATE UNIQUE INDEX "ProductSkuOdmCustomerPrice_one_active" ON "ProductSkuOdmCustomerPrice"("skuId", "accountId") WHERE "archivedAt" IS NULL;
CREATE INDEX "ProductSkuOdmCustomerPrice_skuId_accountId_archivedAt_idx" ON "ProductSkuOdmCustomerPrice"("skuId", "accountId", "archivedAt");
CREATE INDEX "ProductSkuOdmCustomerPrice_accountId_currencyCode_archivedA_idx" ON "ProductSkuOdmCustomerPrice"("accountId", "currencyCode", "archivedAt");
ALTER TABLE "ProductSkuOdmCustomerPrice" ADD CONSTRAINT "ProductSkuOdmCustomerPrice_skuId_accountId_fkey" FOREIGN KEY ("skuId", "accountId") REFERENCES "ProductSkuOdmCustomer"("skuId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OpportunityProduct"
  ADD COLUMN "odmCustomerPriceId" INTEGER,
  ADD COLUMN "odmCustomerAccountId" INTEGER,
  ADD COLUMN "odmCustomerBasePrice" DECIMAL(12,2),
  ADD COLUMN "odmCustomerTariffPercent" DECIMAL(9,4),
  ADD COLUMN "odmCustomerTariffAmount" DECIMAL(12,2),
  ADD COLUMN "odmCustomerFinalUnitPrice" DECIMAL(12,2),
  ADD COLUMN "odmCustomerCurrencyCode" VARCHAR(3),
  ADD COLUMN "odmCustomerEffectiveDate" DATE;
CREATE INDEX "OpportunityProduct_odmCustomerPriceId_idx" ON "OpportunityProduct"("odmCustomerPriceId");
CREATE INDEX "OpportunityProduct_odmCustomerAccountId_idx" ON "OpportunityProduct"("odmCustomerAccountId");
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_odmCustomerPriceId_fkey" FOREIGN KEY ("odmCustomerPriceId") REFERENCES "ProductSkuOdmCustomerPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
