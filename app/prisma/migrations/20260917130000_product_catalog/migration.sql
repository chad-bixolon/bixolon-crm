-- Preserve every Product and OpportunityProduct row. Backfill legacy one-SKU Products.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Product"
    GROUP BY upper(regexp_replace(btrim("sku"), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Products contain duplicate normalized SKUs; resolve these before migrating';
  END IF;
END $$;

CREATE TYPE "ProductPriceUnit" AS ENUM ('EACH', 'CASE', 'BOX', 'ROLL');
CREATE TYPE "ProductPriceTier" AS ENUM ('STANDARD', 'MSRP', 'RESELLER', 'DISTRIBUTOR');

CREATE TABLE "ProductSku" (
  "id" SERIAL NOT NULL,
  "productId" INTEGER NOT NULL,
  "partNumber" TEXT NOT NULL,
  "normalizedPartNumber" TEXT NOT NULL,
  "description" TEXT,
  "priceUnit" "ProductPriceUnit" NOT NULL DEFAULT 'EACH',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSku_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductSku_normalizedPartNumber_key" ON "ProductSku"("normalizedPartNumber");
CREATE INDEX "ProductSku_productId_idx" ON "ProductSku"("productId");
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductPrice" (
  "id" SERIAL NOT NULL,
  "skuId" INTEGER NOT NULL,
  "tier" "ProductPriceTier" NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductPrice_skuId_currencyCode_tier_key" ON "ProductPrice"("skuId", "currencyCode", "tier");
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_amount_check" CHECK ("amount" >= 0);

INSERT INTO "ProductSku" ("productId", "partNumber", "normalizedPartNumber", "active", "createdAt", "updatedAt")
SELECT "id", "sku", upper(regexp_replace(btrim("sku"), '[[:space:]]+', ' ', 'g')), "active", "createdAt", "updatedAt"
FROM "Product";
COMMIT;
