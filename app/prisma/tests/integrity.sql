-- Run only against the isolated test database after legacy-fixture.sql and migrations.
BEGIN;
\o /dev/null
CREATE TEMP TABLE test_results (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.expect_failure(label text, statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION '%: expected %, got % (%)',label,expected_state,SQLSTATE,SQLERRM; END IF;
    INSERT INTO test_results VALUES(label);
    RETURN;
  END;
  RAISE EXCEPTION '%: unexpectedly accepted invalid data',label;
END $$;
CREATE FUNCTION pg_temp.assert_true(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
  INSERT INTO test_results VALUES(label);
END $$;

INSERT INTO "AccountBusinessRole" ("accountId",role,"updatedAt") VALUES (100,'ISV',now());
SELECT pg_temp.assert_true('multiple account roles',(SELECT count(*)=2 FROM "AccountBusinessRole" WHERE "accountId"=100));
SELECT pg_temp.expect_failure('duplicate account role',$q$INSERT INTO "AccountBusinessRole" ("accountId",role,"updatedAt") VALUES(100,'VAR',now())$q$,'23505');
SELECT pg_temp.expect_failure('strategic is not a role',$q$INSERT INTO "AccountBusinessRole" ("accountId",role,"updatedAt") VALUES(100,'STRATEGIC',now())$q$,'22P02');
UPDATE "Account" SET "strategicAccount"=true WHERE id=100;
SELECT pg_temp.assert_true('strategic independent of roles',(SELECT "strategicAccount" FROM "Account" WHERE id=100));
SELECT pg_temp.expect_failure('unknown industry',$q$UPDATE "Account" SET industry='UNKNOWN' WHERE id=100$q$,'23503');
SELECT pg_temp.expect_failure('unknown territory',$q$UPDATE "Account" SET territory='UNKNOWN' WHERE id=100$q$,'23503');
SELECT pg_temp.expect_failure('account archive state',$q$UPDATE "Account" SET status='ARCHIVED' WHERE id=100$q$,'23514');

INSERT INTO "OpportunityAccount" ("opportunityId","accountId","updatedAt") VALUES(100,101,now());
INSERT INTO "OpportunityAccountRole" ("opportunityId","accountId",role,"updatedAt") VALUES(100,101,'END_USER',now()),(100,101,'VAR_RESELLER',now());
SELECT pg_temp.assert_true('multiple participating accounts',(SELECT count(*)=2 FROM "OpportunityAccount" WHERE "opportunityId"=100));
SELECT pg_temp.assert_true('multiple participant roles',(SELECT count(*)=2 FROM "OpportunityAccountRole" WHERE "opportunityId"=100 AND "accountId"=101));
SELECT pg_temp.expect_failure('duplicate participant role',$q$INSERT INTO "OpportunityAccountRole" ("opportunityId","accountId",role,"updatedAt") VALUES(100,101,'END_USER',now())$q$,'23505');
SELECT pg_temp.expect_failure('task inconsistent membership',$q$UPDATE "Task" SET "accountId"=102 WHERE id=101$q$,'23503');
UPDATE "Activity" SET "accountId"=102 WHERE id=100;
SELECT pg_temp.assert_true('historical activity permits former participant',(SELECT "accountId"=102 AND "opportunityId"=100 FROM "Activity" WHERE id=100));
UPDATE "Activity" SET "accountId"=100 WHERE id=100;
INSERT INTO "OpportunityAccount" ("opportunityId","accountId","updatedAt") VALUES(100,102,now());
INSERT INTO "Activity" (id,"accountId","opportunityId",type,subject,"updatedAt") SELECT 102,102,100,type,'Former participant',now() FROM "Activity" WHERE id=100;
DELETE FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=102;
SELECT pg_temp.assert_true('activity retained after participant removal',(SELECT "accountId"=102 AND "opportunityId"=100 FROM "Activity" WHERE id=102));
SELECT pg_temp.expect_failure('note inconsistent membership',$q$UPDATE "Note" SET "accountId"=102 WHERE id=101$q$,'23503');
UPDATE "Task" SET "accountId"=101 WHERE id=101;
SELECT pg_temp.assert_true('task may use another participating account',(SELECT "accountId"=101 FROM "Task" WHERE id=101));
SELECT pg_temp.expect_failure('referenced membership delete',$q$DELETE FROM "OpportunityAccount" WHERE "opportunityId"=100 AND "accountId"=100$q$,'23503');
SELECT pg_temp.expect_failure('referenced membership update',$q$UPDATE "OpportunityAccount" SET "accountId"=102 WHERE "opportunityId"=100 AND "accountId"=100$q$,'23503');
SELECT pg_temp.expect_failure('activity requires parent',$q$UPDATE "Activity" SET "accountId"=NULL,"opportunityId"=NULL WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('note requires parent',$q$UPDATE "Note" SET "accountId"=NULL,"opportunityId"=NULL WHERE id=100$q$,'23514');
SELECT pg_temp.assert_true('standalone task',(SELECT "accountId" IS NULL AND "opportunityId" IS NULL FROM "Task" WHERE id=100));
SELECT pg_temp.assert_true('account-only task',(SELECT "accountId" IS NOT NULL AND "opportunityId" IS NULL FROM "Task" WHERE id=102));
SELECT pg_temp.assert_true('opportunity-only task',(SELECT "accountId" IS NULL AND "opportunityId" IS NOT NULL FROM "Task" WHERE id=103));
SELECT pg_temp.assert_true('opportunity-only activity',(SELECT "accountId" IS NULL AND "opportunityId" IS NOT NULL FROM "Activity" WHERE id=101));
UPDATE "Note" SET "accountId"=NULL WHERE id=101;
SELECT pg_temp.assert_true('opportunity-only note',(SELECT "accountId" IS NULL AND "opportunityId" IS NOT NULL FROM "Note" WHERE id=101));

SELECT pg_temp.expect_failure('one primary contact',$q$UPDATE "Contact" SET "isPrimary"=true WHERE id=101$q$,'23505');
SELECT pg_temp.expect_failure('primary contact must be active',$q$UPDATE "Contact" SET active=false WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('primary contact cannot be archived',$q$UPDATE "Contact" SET "archivedAt"=now(),active=false WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('archived contact inactive',$q$UPDATE "Contact" SET "archivedAt"=now() WHERE id=101$q$,'23514');
SELECT pg_temp.expect_failure('stage high probability',$q$UPDATE "SalesStage" SET probability=101 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('stage negative probability',$q$UPDATE "SalesStage" SET probability=-1 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('stage negative sort',$q$UPDATE "SalesStage" SET "sortOrder"=-1 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('won stage must be closed',$q$UPDATE "SalesStage" SET "isWon"=true WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('closed won probability',$q$UPDATE "SalesStage" SET probability=50 WHERE id=101$q$,'23514');
SELECT pg_temp.expect_failure('closed lost probability',$q$UPDATE "SalesStage" SET probability=50 WHERE id=102$q$,'23514');
SELECT pg_temp.expect_failure('opportunity probability',$q$UPDATE "Opportunity" SET probability=101 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('zero quantity',$q$UPDATE "OpportunityProduct" SET quantity=0 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('negative quantity',$q$UPDATE "OpportunityProduct" SET quantity=-1 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('negative price',$q$UPDATE "OpportunityProduct" SET "unitPrice"=-0.01 WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('missing price',$q$UPDATE "OpportunityProduct" SET "unitPrice"=NULL WHERE id=100$q$,'23502');
SELECT pg_temp.expect_failure('NaN price',$q$UPDATE "OpportunityProduct" SET "unitPrice"='NaN'::numeric WHERE id=100$q$,'23514');
SELECT pg_temp.assert_true('decimal money total',(SELECT sum(quantity*"unitPrice")=46.00 FROM "OpportunityProduct" WHERE "opportunityId"=100 AND "archivedAt" IS NULL));
UPDATE "OpportunityProduct" SET "archivedAt"=now() WHERE id=101;
SELECT pg_temp.assert_true('archived lines excluded',(SELECT sum(quantity*"unitPrice")=37.50 FROM "OpportunityProduct" WHERE "opportunityId"=100 AND "archivedAt" IS NULL));
SELECT pg_temp.assert_true('no lines means zero',(SELECT coalesce(sum(quantity*"unitPrice"),0)=0 FROM "OpportunityProduct" WHERE "opportunityId"=-1 AND "archivedAt" IS NULL));
UPDATE "OpportunityProduct" SET "unitPrice"=0 WHERE id=100;
SELECT pg_temp.assert_true('zero estimate allowed',(SELECT "unitPrice"=0 FROM "OpportunityProduct" WHERE id=100));
SELECT pg_temp.expect_failure('unknown currency',$q$UPDATE "Opportunity" SET "currencyCode"='ZZZ' WHERE id=100$q$,'23503');
SELECT pg_temp.expect_failure('invalid currency code',$q$INSERT INTO "Currency"(code,name,"updatedAt") VALUES('us','invalid',now())$q$,'23514');
SELECT pg_temp.expect_failure('invalid task status',$q$UPDATE "Task" SET status='UNKNOWN' WHERE id=100$q$,'22P02');
SELECT pg_temp.expect_failure('invalid task priority',$q$UPDATE "Task" SET priority='UNKNOWN' WHERE id=100$q$,'22P02');
SELECT pg_temp.expect_failure('invalid forecast',$q$UPDATE "Opportunity" SET "forecastCategory"='UNKNOWN' WHERE id=100$q$,'22P02');
SELECT pg_temp.expect_failure('invalid attribution',$q$UPDATE "Note" SET "createdById"=-1 WHERE id=100$q$,'23503');
UPDATE "Note" SET "createdById"=100,"updatedById"=100 WHERE id=100;
SELECT pg_temp.assert_true('attribution references user',(SELECT "createdById"=100 AND "updatedById"=100 FROM "Note" WHERE id=100));

INSERT INTO "User"(id,email,"firstName","lastName","updatedAt") VALUES(200,'second@example.invalid','Second','Fixture',now());
INSERT INTO "ExternalIdentity"("userId",issuer,subject,"updatedAt") VALUES(100,'https://accounts.google.com','fixture-subject',now());
SELECT pg_temp.expect_failure('unique external identity',$q$INSERT INTO "ExternalIdentity"("userId",issuer,subject,"updatedAt") VALUES(200,'https://accounts.google.com','fixture-subject',now())$q$,'23505');
SELECT pg_temp.expect_failure('one identity per user/provider',$q$INSERT INTO "ExternalIdentity"("userId",issuer,subject,"updatedAt") VALUES(100,'https://accounts.google.com','different-subject',now())$q$,'23505');
SELECT pg_temp.expect_failure('identity must be nonempty',$q$INSERT INTO "ExternalIdentity"("userId",issuer,subject,"updatedAt") VALUES(200,'https://accounts.google.com',' ',now())$q$,'23514');
SELECT pg_temp.expect_failure('archived user inactive',$q$UPDATE "User" SET "archivedAt"=now() WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('archived product inactive',$q$UPDATE "Product" SET "archivedAt"=now() WHERE id=100$q$,'23514');
SELECT pg_temp.expect_failure('account deletion restricted',$q$DELETE FROM "Account" WHERE id=100$q$,'23503');
SELECT pg_temp.expect_failure('opportunity deletion restricted',$q$DELETE FROM "Opportunity" WHERE id=100$q$,'23503');
SELECT pg_temp.expect_failure('user deletion restricted',$q$DELETE FROM "User" WHERE id=100$q$,'23503');
UPDATE "Account" SET status='ARCHIVED',"archivedAt"=now(),"archivedById"=100 WHERE id=100;
UPDATE "Opportunity" SET "archivedAt"=now(),"archivedById"=100 WHERE id=100;
SELECT pg_temp.assert_true('archival preserves history',(SELECT count(*)=3 FROM "Activity") AND (SELECT count(*)=2 FROM "Note"));
SELECT pg_temp.assert_true('archival does not rewrite children',NOT EXISTS (SELECT 1 FROM "Activity" WHERE "archivedAt" IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM "Note" WHERE "archivedAt" IS NOT NULL));
SELECT pg_temp.assert_true('history FKs never cascade delete',NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.confdeltype='c'));
\o
SELECT count(*) AS integrity_checks_passed FROM test_results;
ROLLBACK;
