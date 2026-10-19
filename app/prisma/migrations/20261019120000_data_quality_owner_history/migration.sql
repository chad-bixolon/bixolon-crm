-- Additive only: existing history remains untouched and both new fields stay NULL.
ALTER TABLE "AdminMaintenanceEvent"
  ADD COLUMN "newOwnerId" INTEGER,
  ADD COLUMN "newOwnerName" TEXT;

-- History is append-only. Preserve the reference rather than cascading a change.
ALTER TABLE "AdminMaintenanceEvent"
  ADD CONSTRAINT "AdminMaintenanceEvent_newOwnerId_fkey"
  FOREIGN KEY ("newOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
