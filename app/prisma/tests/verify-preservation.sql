DO $$ DECLARE original record; actual jsonb; model text; BEGIN
  FOR original IN SELECT * FROM fixture_audit.original_rows LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id=$1', original.model) INTO actual USING original.id;
    IF actual IS NULL OR NOT actual @> original.original THEN
      RAISE EXCEPTION 'Original data changed in % id %',original.model,original.id;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM "AccountBusinessRole") <> 2 THEN RAISE EXCEPTION 'Role backfill failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Industry" WHERE code=' Retail ' AND name=' Retail ') THEN RAISE EXCEPTION 'Category preservation failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=100) THEN RAISE EXCEPTION 'Membership backfill failed'; END IF;
  IF EXISTS (SELECT 1 FROM "OpportunityAccountRole") THEN RAISE EXCEPTION 'Participant roles should not be guessed'; END IF;
  IF EXISTS (SELECT 1 FROM "Account" WHERE "strategicAccount" OR "createdById" IS NOT NULL OR "updatedById" IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected attribution/classification'; END IF;
  IF (SELECT role FROM "User" WHERE id=100) <> 'READ_ONLY' THEN RAISE EXCEPTION 'Role default failed'; END IF;
  IF (SELECT "currencyCode" FROM "Opportunity" WHERE id=100) <> 'USD' THEN RAISE EXCEPTION 'Currency default failed'; END IF;
  IF (SELECT sum(quantity*"unitPrice") FROM "OpportunityProduct" WHERE "opportunityId"=100 AND "archivedAt" IS NULL) <> 46 THEN RAISE EXCEPTION 'Monetary total failed'; END IF;
END $$;
SELECT count(*) AS original_rows_preserved FROM fixture_audit.original_rows;
