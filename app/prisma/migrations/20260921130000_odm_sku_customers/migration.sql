CREATE TABLE "ProductSkuOdmCustomer" (
  "skuId" INTEGER NOT NULL,
  "accountId" INTEGER NOT NULL,
  "sourceCustomerName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSkuOdmCustomer_pkey" PRIMARY KEY ("skuId", "accountId")
);

CREATE INDEX "ProductSkuOdmCustomer_accountId_idx" ON "ProductSkuOdmCustomer"("accountId");
ALTER TABLE "ProductSkuOdmCustomer" ADD CONSTRAINT "ProductSkuOdmCustomer_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSkuOdmCustomer" ADD CONSTRAINT "ProductSkuOdmCustomer_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ProductSkuOdmCustomer" ("skuId", "accountId", "sourceCustomerName", "createdAt", "updatedAt")
SELECT id, "odmCustomerAccountId", "odmCustomerSourceName", "createdAt", CURRENT_TIMESTAMP
FROM "ProductSku" WHERE "odmCustomerAccountId" IS NOT NULL;

ALTER TABLE "ProductSku" DROP CONSTRAINT "ProductSku_odm_metadata_classification_check";
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_odm_metadata_classification_check"
  CHECK ("catalogSource"::text IN ('ODM', 'SPECIAL_SKU_LIST') OR ("odmCustomerSourceName" IS NULL AND "baseSkuId" IS NULL AND "odmDescription" IS NULL));
ALTER TABLE "ProductSku" DROP CONSTRAINT "ProductSku_odmCustomerAccountId_fkey";
DROP INDEX "ProductSku_odmCustomerAccountId_idx";
ALTER TABLE "ProductSku" DROP COLUMN "odmCustomerAccountId";

CREATE FUNCTION "ProductSkuOdmCustomer_check_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ProductSku" WHERE id = NEW."skuId" AND "catalogSource"::text = 'ODM') THEN
    RAISE EXCEPTION 'ODM customer association requires an ODM SKU';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductSkuOdmCustomer_check_source_trigger"
  BEFORE INSERT OR UPDATE OF "skuId" ON "ProductSkuOdmCustomer"
  FOR EACH ROW EXECUTE FUNCTION "ProductSkuOdmCustomer_check_source"();

CREATE FUNCTION "ProductSku_check_odm_customers"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."catalogSource"::text IS DISTINCT FROM 'ODM'
     AND EXISTS (SELECT 1 FROM "ProductSkuOdmCustomer" WHERE "skuId" = NEW.id) THEN
    RAISE EXCEPTION 'Remove ODM customer associations before changing SKU classification';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductSku_check_odm_customers_trigger"
  BEFORE UPDATE OF "catalogSource" ON "ProductSku"
  FOR EACH ROW EXECUTE FUNCTION "ProductSku_check_odm_customers"();
