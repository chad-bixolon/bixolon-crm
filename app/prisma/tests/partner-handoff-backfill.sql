-- Applied immediately before the handoff migration, only in the disposable replay DB.
INSERT INTO "Account" (id,name,"updatedAt") VALUES (930000,'Partner backfill',now());
INSERT INTO "TradeShow" (id,name,"createdById","updatedAt") SELECT 930000,'Active partner backfill',id,now() FROM "User" ORDER BY id LIMIT 1;
INSERT INTO "TradeShow" (id,name,"createdById","archivedAt","updatedAt") SELECT 930001,'Archived partner backfill',id,now(),now() FROM "User" ORDER BY id LIMIT 1;
INSERT INTO "TradeShowImport" (id,"tradeShowId",format,"sourceFileName","sourceSheet","fileSha256","uploadedById")
  SELECT 930000,930000,'CUSTOM_MAPPING','fixture.xlsx','Leads','backfill',id FROM "User" ORDER BY id LIMIT 1;
INSERT INTO "TradeShowImport" (id,"tradeShowId",format,"sourceFileName","sourceSheet","fileSha256","uploadedById")
  SELECT 930001,930001,'CUSTOM_MAPPING','fixture.xlsx','Leads','backfill',id FROM "User" ORDER BY id LIMIT 1;
INSERT INTO "TradeShowLead" (id,"tradeShowId","firstImportId","sourceKey","sourceFileName","sourceSheet","sourceRow","rawSourceData","firstName","lastName",status,routing,"routedPartnerAccountId","updatedAt") VALUES
  (930000,930000,930000,'new','fixture.xlsx','Leads',1,'{}','New','Partner','NEW','REFERRED_TO_PARTNER',930000,now()),
  (930001,930000,930000,'qualified','fixture.xlsx','Leads',2,'{}','Qualified','Partner','QUALIFIED','REFERRED_TO_PARTNER',930000,now()),
  (930002,930000,930000,'closed','fixture.xlsx','Leads',3,'{}','Closed','Partner','DISQUALIFIED','REFERRED_TO_PARTNER',930000,now()),
  (930003,930000,930000,'converted','fixture.xlsx','Leads',4,'{}','Converted','Partner','CONVERTED','REFERRED_TO_PARTNER',930000,now()),
  (930004,930001,930001,'archived','fixture.xlsx','Leads',5,'{}','Archived','Partner','NEW','REFERRED_TO_PARTNER',930000,now()),
  (930005,930000,930000,'internal','fixture.xlsx','Leads',6,'{}','Internal','Lead','NEW','UNREVIEWED',null,now());
