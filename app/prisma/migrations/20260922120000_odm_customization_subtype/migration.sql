BEGIN;

CREATE TYPE "OdmCustomizationSubtype" AS ENUM (
  'CUSTOMER_SPECIFIC', 'SPECIAL_CONFIGURATION', 'CABLE_PACKAGING_ACCESSORY', 'OTHER', 'LEGACY_SPECIAL_SKU'
);

ALTER TABLE "ProductSku" ADD COLUMN "odmSubtype" "OdmCustomizationSubtype";

DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(special.id::text || ':' || special."partNumber" || ' -> ' || child.id::text || ':' || child."partNumber", ', ' ORDER BY special.id, child.id)
  INTO conflicts FROM "ProductSku" special
    JOIN "ProductSku" child ON child."baseSkuId" = special.id
    WHERE special."catalogSource" = 'SPECIAL_SKU_LIST';
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Special SKU base references must be resolved before ODM conversion: %', conflicts;
  END IF;
END $$;

UPDATE "ProductSku"
SET "catalogSource" = 'ODM', "odmSubtype" = 'LEGACY_SPECIAL_SKU'
WHERE "catalogSource" = 'SPECIAL_SKU_LIST';

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_odm_subtype_source_check"
  CHECK ("odmSubtype" IS NULL OR "catalogSource" = 'ODM');

COMMIT;
