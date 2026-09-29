-- Synthetic Demo relationship checks. This entire script rolls back.
BEGIN;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN INSERT INTO "DemoRequest" (id, "requestedAt", "updatedAt") VALUES (9001, now(), now());
  EXCEPTION WHEN not_null_violation THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Demo without Account was accepted'; END IF;
END $$;
INSERT INTO "DemoRequest" (id, "accountId", "requestedAt", "updatedAt") VALUES (9000, 100, now(), now());
UPDATE "DemoRequest" SET "projectId"=1000 WHERE id=9000;
UPDATE "DemoRequest" SET "projectId"=NULL,"opportunityId"=100 WHERE id=9000;
UPDATE "DemoRequest" SET "projectId"=1000, "opportunityId"=100 WHERE id=9000;
DO $$
DECLARE rejected boolean;
BEGIN
  rejected := false;
  BEGIN UPDATE "DemoRequest" SET "accountId"=102 WHERE id=9000;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Demo%' THEN RAISE; END IF;
    rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unrelated Demo context was accepted'; END IF;
  rejected := false;
  BEGIN UPDATE "Project" SET "primaryAccountId"=101 WHERE id=1000;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Demo%' THEN RAISE; END IF;
    rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Project change orphaned Demo'; END IF;
  rejected := false;
  BEGIN DELETE FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=100;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Demo%' THEN RAISE; END IF;
    rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Opportunity participant removal orphaned Demo'; END IF;
END $$;
UPDATE "DemoRequest" SET "projectId"=NULL,"opportunityId"=NULL WHERE id=9000;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "DemoRequest" WHERE id=9000 AND "accountId"=100 AND "projectId" IS NULL AND "opportunityId" IS NULL)
  THEN RAISE EXCEPTION 'Account-only Demo was not preserved'; END IF;
END $$;
ROLLBACK;
