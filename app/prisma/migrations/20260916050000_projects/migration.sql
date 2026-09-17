-- Forward-only, additive migration for Prisma 6.19.3 / PostgreSQL.
-- Staged only; do not deploy to the live database without final approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectPartyRole" AS ENUM ('PROGRAM_OWNER', 'END_CUSTOMER', 'DISTRIBUTOR', 'VAR_RESELLER', 'INTEGRATOR', 'ISV', 'OEM', 'SERVICE_PROVIDER', 'CONNECTIVITY_PROVIDER', 'IMPLEMENTATION_PARTNER', 'OTHER');

CREATE TABLE "Project" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "primaryAccountId" INTEGER NOT NULL,
  "primaryAccountRole" "ProjectPartyRole" NOT NULL,
  "ownerId" INTEGER,
  "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
  "description" TEXT,
  "startDate" TIMESTAMP(3),
  "targetEndDate" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdById" INTEGER NOT NULL,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Project_name_nonempty_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "Project_date_order_check" CHECK ("startDate" IS NULL OR "targetEndDate" IS NULL OR "targetEndDate" >= "startDate")
);

CREATE TABLE "ProjectAccount" (
  "projectId" INTEGER NOT NULL,
  "accountId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAccount_pkey" PRIMARY KEY ("projectId", "accountId")
);

CREATE TABLE "ProjectAccountRole" (
  "projectId" INTEGER NOT NULL,
  "accountId" INTEGER NOT NULL,
  "role" "ProjectPartyRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAccountRole_pkey" PRIMARY KEY ("projectId", "accountId", "role")
);

CREATE INDEX "Project_primaryAccountId_archivedAt_idx" ON "Project" ("primaryAccountId", "archivedAt");
CREATE INDEX "Project_ownerId_status_idx" ON "Project" ("ownerId", "status");
CREATE INDEX "Project_status_archivedAt_idx" ON "Project" ("status", "archivedAt");
CREATE INDEX "Project_createdById_idx" ON "Project" ("createdById");
CREATE INDEX "Project_updatedById_idx" ON "Project" ("updatedById");
CREATE INDEX "ProjectAccount_accountId_projectId_idx" ON "ProjectAccount" ("accountId", "projectId");
CREATE INDEX "ProjectAccountRole_role_projectId_idx" ON "ProjectAccountRole" ("role", "projectId");

ALTER TABLE "Opportunity" ADD COLUMN "projectId" INTEGER;
ALTER TABLE "Task" ADD COLUMN "projectId" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "projectId" INTEGER;
ALTER TABLE "Note" ADD COLUMN "projectId" INTEGER;
CREATE INDEX "Opportunity_projectId_archivedAt_idx" ON "Opportunity" ("projectId", "archivedAt");
CREATE INDEX "Task_projectId_status_idx" ON "Task" ("projectId", "status");
CREATE INDEX "Activity_projectId_activityDate_idx" ON "Activity" ("projectId", "activityDate");
CREATE INDEX "Note_projectId_createdAt_idx" ON "Note" ("projectId", "createdAt");

ALTER TABLE "Project" ADD CONSTRAINT "Project_primaryAccountId_fkey" FOREIGN KEY ("primaryAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAccount" ADD CONSTRAINT "ProjectAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAccount" ADD CONSTRAINT "ProjectAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAccountRole" ADD CONSTRAINT "ProjectAccountRole_projectId_accountId_fkey" FOREIGN KEY ("projectId", "accountId") REFERENCES "ProjectAccount" ("projectId", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing Activity/Note rows while allowing a direct Project parent.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_parent_check";
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_parent_check" CHECK ("accountId" IS NOT NULL OR "opportunityId" IS NOT NULL OR "projectId" IS NOT NULL);
ALTER TABLE "Note" DROP CONSTRAINT "Note_parent_check";
ALTER TABLE "Note" ADD CONSTRAINT "Note_parent_check" CHECK ("accountId" IS NOT NULL OR "opportunityId" IS NOT NULL OR "projectId" IS NOT NULL);

-- Lock the Project row so concurrent participant and primary-account edits serialize.
CREATE FUNCTION "ProjectAccount_reject_primary"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE primary_id INTEGER;
BEGIN
  SELECT "primaryAccountId" INTO primary_id FROM "Project" WHERE "id" = NEW."projectId" FOR UPDATE;
  IF primary_id = NEW."accountId" THEN
    RAISE EXCEPTION 'Primary account cannot be an additional project participant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProjectAccount_reject_primary_trigger"
BEFORE INSERT OR UPDATE OF "projectId", "accountId" ON "ProjectAccount"
FOR EACH ROW EXECUTE FUNCTION "ProjectAccount_reject_primary"();

CREATE FUNCTION "Project_reject_participant_primary"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ProjectAccount" WHERE "projectId" = NEW."id" AND "accountId" = NEW."primaryAccountId") THEN
    RAISE EXCEPTION 'Primary account cannot be an additional project participant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Project_reject_participant_primary_trigger"
BEFORE UPDATE OF "primaryAccountId" ON "Project"
FOR EACH ROW EXECUTE FUNCTION "Project_reject_participant_primary"();

COMMIT;
