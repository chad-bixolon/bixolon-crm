-- Run through psql with ON_ERROR_STOP=1. All fixtures roll back.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User") THEN RAISE EXCEPTION 'A local User is required for this test'; END IF;
  IF EXISTS (SELECT 1 FROM "TradeShow" WHERE id BETWEEN -2120000010 AND -2120000000)
     OR EXISTS (SELECT 1 FROM "TradeShowImport" WHERE id BETWEEN -2120000010 AND -2120000000)
     OR EXISTS (SELECT 1 FROM "TradeShowLead" WHERE id BETWEEN -2120000010 AND -2120000000)
  THEN RAISE EXCEPTION 'Reserved Trade Show test ID collision'; END IF;
END $$;

INSERT INTO "TradeShow" (id, name, "createdById", "updatedAt")
SELECT id, 'Trade Show test', (SELECT id FROM "User" ORDER BY id LIMIT 1), now()
FROM (VALUES (-2120000001), (-2120000002)) AS ids(id);

INSERT INTO "TradeShowImport" (id, "tradeShowId", format, "sourceFileName", "sourceSheet", "fileSha256", "uploadedById")
SELECT id, show_id, 'NRA_NRF', 'test.xls', 'ExportExtensionsFlatFile1', repeat('a', 64),
       (SELECT id FROM "User" ORDER BY id LIMIT 1)
FROM (VALUES (-2120000001, -2120000001), (-2120000002, -2120000002)) AS ids(id, show_id);

INSERT INTO "TradeShowLead" (id, "tradeShowId", "firstImportId", "sourceKey", "sourceFileName", "sourceSheet", "sourceRow", "rawSourceData", "firstName", "lastName", "updatedAt")
VALUES
  (-2120000001, -2120000001, -2120000001, 'same-scan-key', 'test.xls', 'ExportExtensionsFlatFile1', 2, '{"Badge Id":"untrusted-badge"}'::jsonb, 'A', 'Lead', now()),
  (-2120000002, -2120000002, -2120000002, 'same-scan-key', 'test.xls', 'ExportExtensionsFlatFile1', 2, '{"Badge Id":"untrusted-badge"}'::jsonb, 'A', 'Lead', now());

DO $$ BEGIN
  IF (SELECT count(*) FROM "TradeShowLead" WHERE id IN (-2120000001, -2120000002)) <> 2
     OR EXISTS (SELECT 1 FROM "TradeShowLead" WHERE id IN (-2120000001, -2120000002) AND "sourceLeadId" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "TradeShowLead" WHERE id IN (-2120000001, -2120000002) AND "rawSourceData"->>'Badge Id' <> 'untrusted-badge')
  THEN RAISE EXCEPTION 'Trade Show provenance or show-scoped key check failed'; END IF;
  BEGIN
    INSERT INTO "TradeShowLead" (id, "tradeShowId", "firstImportId", "sourceKey", "sourceFileName", "sourceSheet", "sourceRow", "rawSourceData", "firstName", "lastName", "updatedAt")
    VALUES (-2120000003, -2120000001, -2120000001, 'same-scan-key', 'test.xls', 'ExportExtensionsFlatFile1', 3, '{}'::jsonb, 'B', 'Lead', now());
    RAISE EXCEPTION 'Duplicate sourceKey within one Trade Show was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "TradeShowLead" (id, "tradeShowId", "firstImportId", "sourceKey", "sourceFileName", "sourceSheet", "sourceRow", "rawSourceData", "firstName", "lastName", "updatedAt")
    VALUES (-2120000004, -2120000001, -2120000002, 'different-key', 'test.xls', 'ExportExtensionsFlatFile1', 4, '{}'::jsonb, 'C', 'Lead', now());
    RAISE EXCEPTION 'Cross-show first import was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

ROLLBACK;
