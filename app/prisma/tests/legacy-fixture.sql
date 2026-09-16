-- Synthetic records only; never run this file against the CRM database.
INSERT INTO "User" (id,email,"firstName","lastName","updatedAt")
VALUES (100,'fixture@example.invalid','Fixture','Owner','2026-01-02');
INSERT INTO "Account" (id,name,status,"accountType",industry,territory,"ownerId","updatedAt") VALUES
  (100,'Fixture reseller','ACTIVE','VAR',' Retail ','East',100,'2026-01-02'),
  (101,'Fixture customer','ACTIVE','END_USER',NULL,NULL,NULL,'2026-01-03'),
  (102,'Fixture inactive','INACTIVE',NULL,NULL,NULL,NULL,'2026-01-04');
INSERT INTO "Contact" (id,"accountId","firstName","lastName","isPrimary","updatedAt") VALUES
  (100,100,'Primary','Fixture',true,'2026-01-02'),
  (101,100,'Secondary','Fixture',false,'2026-01-03');
INSERT INTO "SalesStage" (id,name,"sortOrder",probability,"isClosed","isWon","updatedAt") VALUES
  (100,'Qualified',10,25,false,false,'2026-01-02'),
  (101,'Won',20,100,true,true,'2026-01-02'),
  (102,'Lost',30,0,true,false,'2026-01-02');
INSERT INTO "Opportunity" (id,"accountId","ownerId","stageId",name,probability,"forecastCategory","updatedAt")
VALUES (100,100,100,100,'Fixture opportunity',40,'COMMIT','2026-01-02');
INSERT INTO "Product" (id,sku,name,"updatedAt") VALUES (100,'FIXTURE-001','Fixture printer','2026-01-02');
INSERT INTO "OpportunityProduct" (id,"opportunityId","productId",quantity,"unitPrice","updatedAt") VALUES
  (100,100,100,3,12.50,'2026-01-02'), (101,100,100,2,4.25,'2026-01-03');
INSERT INTO "Task" (id,"accountId","opportunityId","assignedToId",subject,status,priority,"updatedAt") VALUES
  (100,NULL,NULL,100,'Standalone','IN_PROGRESS','HIGH','2026-01-02'),
  (101,100,100,100,'Related','COMPLETED','LOW','2026-01-03'),
  (102,100,NULL,NULL,'Account only','OPEN','NORMAL','2026-01-04'),
  (103,NULL,100,NULL,'Opportunity only','CANCELLED','URGENT','2026-01-05');
INSERT INTO "Activity" (id,"accountId","opportunityId","userId",type,subject,"updatedAt") VALUES
  (100,100,100,100,'CALL','Related call','2026-01-02'),
  (101,NULL,100,NULL,'Custom activity','Opportunity only','2026-01-03');
INSERT INTO "Note" (id,"accountId","opportunityId",body,"updatedAt") VALUES
  (100,100,NULL,'Account note','2026-01-02'),
  (101,100,100,'Related note','2026-01-03');

-- Capture every original value, including timestamps, without depending on new columns.
CREATE SCHEMA fixture_audit;
CREATE TABLE fixture_audit.original_rows (model text, id integer, original jsonb);
DO $$ DECLARE model text; BEGIN
  FOREACH model IN ARRAY ARRAY['User','Account','Contact','SalesStage','Opportunity','Product','OpportunityProduct','Task','Activity','Note'] LOOP
    EXECUTE format('INSERT INTO fixture_audit.original_rows SELECT %L,id,to_jsonb(t) FROM %I t',model,model);
  END LOOP;
END $$;
