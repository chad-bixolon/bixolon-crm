ALTER TABLE "User" ADD COLUMN "delegatedUserAdministrationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminMaintenanceEvent" ADD COLUMN "oldValue" TEXT, ADD COLUMN "newValue" TEXT;
