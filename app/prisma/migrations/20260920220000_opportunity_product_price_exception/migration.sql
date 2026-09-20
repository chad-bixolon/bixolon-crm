CREATE TYPE "OpportunityProductPriceSource" AS ENUM ('MANUAL', 'CATALOG', 'PRICE_EXCEPTION');

ALTER TABLE "OpportunityProduct"
  ADD COLUMN "priceSource" "OpportunityProductPriceSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "catalogPriceTier" "ProductPriceTier",
  ADD COLUMN "priceExceptionLineId" INTEGER,
  ADD COLUMN "priceExceptionCode" TEXT,
  ADD COLUMN "priceExceptionUnitPrice" DECIMAL(12,2),
  ADD COLUMN "priceExceptionCurrencyCode" VARCHAR(3),
  ADD COLUMN "priceExceptionSourceQty" TEXT;

CREATE INDEX "OpportunityProduct_priceSource_idx" ON "OpportunityProduct"("priceSource");
CREATE INDEX "OpportunityProduct_priceExceptionLineId_idx" ON "OpportunityProduct"("priceExceptionLineId");

ALTER TABLE "OpportunityProduct"
  ADD CONSTRAINT "OpportunityProduct_priceExceptionLineId_fkey"
  FOREIGN KEY ("priceExceptionLineId") REFERENCES "PriceExceptionLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OpportunityProduct"
  ADD CONSTRAINT "OpportunityProduct_price_provenance_check" CHECK (
    ("priceSource" = 'MANUAL' AND "catalogPriceTier" IS NULL AND "priceExceptionLineId" IS NULL
      AND "priceExceptionCode" IS NULL AND "priceExceptionUnitPrice" IS NULL
      AND "priceExceptionCurrencyCode" IS NULL AND "priceExceptionSourceQty" IS NULL)
    OR
    ("priceSource" = 'CATALOG' AND "catalogPriceTier" IS NOT NULL AND "priceExceptionLineId" IS NULL
      AND "priceExceptionCode" IS NULL AND "priceExceptionUnitPrice" IS NULL
      AND "priceExceptionCurrencyCode" IS NULL AND "priceExceptionSourceQty" IS NULL)
    OR
    ("priceSource" = 'PRICE_EXCEPTION' AND "catalogPriceTier" IS NULL AND "priceExceptionLineId" IS NOT NULL
      AND "priceExceptionUnitPrice" IS NOT NULL AND "priceExceptionCurrencyCode" IS NOT NULL)
  );
