-- Account pricing belongs to a SKU regardless of its catalog classification.
-- Keep the historical ODM-to-standard guard: an ODM SKU with customer links
-- cannot be silently reclassified by another workflow.
CREATE OR REPLACE FUNCTION "ProductSkuOdmCustomer_check_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ProductSku" WHERE id = NEW."skuId") THEN
    RAISE EXCEPTION 'Customer pricing association requires an existing SKU';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "ProductSku_check_odm_customers"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."catalogSource"::text = 'ODM'
     AND NEW."catalogSource"::text IS DISTINCT FROM 'ODM'
     AND EXISTS (SELECT 1 FROM "ProductSkuOdmCustomer" WHERE "skuId" = NEW.id) THEN
    RAISE EXCEPTION 'Remove ODM customer associations before changing SKU classification';
  END IF;
  RETURN NEW;
END;
$$;
