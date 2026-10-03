ALTER TABLE "OpportunityHistoryEvent"
  ADD COLUMN "relatedRecordId" INTEGER,
  ADD COLUMN "relatedRecordName" TEXT,
  ADD COLUMN "oldRoles" "OpportunityPartyRole"[] DEFAULT ARRAY[]::"OpportunityPartyRole"[],
  ADD COLUMN "newRoles" "OpportunityPartyRole"[] DEFAULT ARRAY[]::"OpportunityPartyRole"[];

ALTER TABLE "OpportunityHistoryArchive"
  ADD COLUMN "relatedRecordId" INTEGER,
  ADD COLUMN "relatedRecordName" TEXT,
  ADD COLUMN "oldRoles" "OpportunityPartyRole"[] DEFAULT ARRAY[]::"OpportunityPartyRole"[],
  ADD COLUMN "newRoles" "OpportunityPartyRole"[] DEFAULT ARRAY[]::"OpportunityPartyRole"[];
