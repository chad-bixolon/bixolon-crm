ALTER TYPE "ProductCatalogSource" ADD VALUE 'ODM';

ALTER TABLE "ProductSku"
  ADD COLUMN "odmCustomerAccountId" INTEGER,
  ADD COLUMN "odmCustomerSourceName" TEXT,
  ADD COLUMN "baseSkuId" INTEGER,
  ADD COLUMN "odmDescription" TEXT;

CREATE INDEX "ProductSku_odmCustomerAccountId_idx" ON "ProductSku"("odmCustomerAccountId");
CREATE INDEX "ProductSku_baseSkuId_idx" ON "ProductSku"("baseSkuId");

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_odmCustomerAccountId_fkey"
  FOREIGN KEY ("odmCustomerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_baseSkuId_fkey"
  FOREIGN KEY ("baseSkuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_odm_metadata_classification_check"
  CHECK ("catalogSource"::text IS NOT DISTINCT FROM 'ODM' OR ("odmCustomerAccountId" IS NULL AND "odmCustomerSourceName" IS NULL AND "baseSkuId" IS NULL AND "odmDescription" IS NULL));
ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_base_not_self_check"
  CHECK ("baseSkuId" IS NULL OR "baseSkuId" <> "id");

CREATE FUNCTION "ProductSku_check_odm_base"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."baseSkuId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "ProductSku" base WHERE base.id = NEW."baseSkuId" AND base."catalogSource"::text = 'ODM'
  ) THEN
    RAISE EXCEPTION 'ODM base SKU must be non-ODM';
  END IF;
  IF NEW."catalogSource"::text = 'ODM' AND EXISTS (
    SELECT 1 FROM "ProductSku" child WHERE child."baseSkuId" = NEW.id
  ) THEN
    RAISE EXCEPTION 'An ODM SKU cannot be a base SKU';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductSku_check_odm_base_trigger"
  BEFORE INSERT OR UPDATE OF "baseSkuId", "catalogSource" ON "ProductSku"
  FOR EACH ROW EXECUTE FUNCTION "ProductSku_check_odm_base"();
