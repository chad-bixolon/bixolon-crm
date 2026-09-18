-- Product classification is optional; existing Products keep categoryId NULL.
BEGIN;

CREATE TABLE "ProductCategory" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

CREATE TYPE "ProductCatalogSource" AS ENUM ('PRICE_LIST', 'PE_LIST', 'SPECIAL_SKU_LIST');

ALTER TABLE "Product" ADD COLUMN "categoryId" INTEGER;
ALTER TABLE "ProductSku" ADD COLUMN "catalogSource" "ProductCatalogSource";

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "ProductSku_catalogSource_productId_idx" ON "ProductSku"("catalogSource", "productId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProductCategory" ("code", "name", "sortOrder", "updatedAt") VALUES
  ('POS', 'POS', 0, CURRENT_TIMESTAMP),
  ('LABEL', 'Label', 10, CURRENT_TIMESTAMP),
  ('MOBILE', 'Mobile', 20, CURRENT_TIMESTAMP),
  ('LASER', 'Laser', 30, CURRENT_TIMESTAMP),
  ('RIBBON', 'Ribbon', 40, CURRENT_TIMESTAMP),
  ('ACCESSORIES', 'Accessories', 50, CURRENT_TIMESTAMP),
  ('PAPER', 'Paper', 60, CURRENT_TIMESTAMP),
  ('WARRANTY', 'Warranty', 70, CURRENT_TIMESTAMP);

COMMIT;
