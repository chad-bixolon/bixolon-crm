-- Forward-only foundation migration. No existing row or column is deleted.
-- Existing text values are cast in place, never silently coerced or normalized.
-- Any incompatible data aborts the entire transaction for explicit review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Account" WHERE "accountType" IS NOT NULL
    AND "accountType" NOT IN ('END_USER','DISTRIBUTOR','VAR','ISV','OEM','PARTNER')) THEN
    RAISE EXCEPTION 'Unsupported legacy accountType; review mappings before migration (STRATEGIC is a classification, not a role)';
  END IF;
  IF EXISTS (SELECT 1 FROM "Account" WHERE "status" = 'ARCHIVED') THEN
    RAISE EXCEPTION 'Existing archived accounts need an explicit archival timestamp mapping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "accountId", "opportunityId" FROM "Task"
      UNION ALL SELECT "accountId", "opportunityId" FROM "Activity"
      UNION ALL SELECT "accountId", "opportunityId" FROM "Note"
    ) AS history JOIN "Opportunity" o ON o.id = history."opportunityId"
    WHERE history."accountId" IS NOT NULL AND history."accountId" <> o."accountId"
  ) THEN
    RAISE EXCEPTION 'Legacy history has conflicting account/opportunity parents; review before migration';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALES_MANAGER', 'SALES', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "AccountBusinessRoleCode" AS ENUM ('END_USER', 'DISTRIBUTOR', 'VAR', 'ISV', 'OEM', 'PARTNER');

-- CreateEnum
CREATE TYPE "OpportunityPartyRole" AS ENUM ('END_USER', 'VAR_RESELLER', 'DISTRIBUTOR', 'ISV_PARTNER', 'OEM', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ForecastCategory" AS ENUM ('OMITTED', 'PIPELINE', 'BEST_CASE', 'COMMIT', 'CLOSED');

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "OpportunityProduct" DROP CONSTRAINT "OpportunityProduct_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_userId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_opportunityId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'READ_ONLY';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "strategicAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedById" INTEGER;

-- Preserve every existing status value while changing its type.
ALTER TABLE "Account" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "status" TYPE "AccountStatus" USING "status"::"AccountStatus";
ALTER TABLE "Account" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "updatedById" INTEGER;

-- AlterTable
ALTER TABLE "SalesStage" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "currencyCode" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "updatedById" INTEGER,
ALTER COLUMN "accountId" DROP NOT NULL,
ALTER COLUMN "forecastCategory" TYPE "ForecastCategory" USING "forecastCategory"::"ForecastCategory";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OpportunityProduct" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ALTER COLUMN "unitPrice" SET NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "updatedById" INTEGER;

ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus";
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "Task" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "priority" TYPE "TaskPriority" USING "priority"::"TaskPriority";
ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "updatedById" INTEGER;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" INTEGER,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "updatedById" INTEGER;

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'GOOGLE',
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBusinessRole" (
    "accountId" INTEGER NOT NULL,
    "role" "AccountBusinessRoleCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBusinessRole_pkey" PRIMARY KEY ("accountId","role")
);

-- CreateTable
CREATE TABLE "Industry" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Territory" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "OpportunityAccount" (
    "opportunityId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityAccount_pkey" PRIMARY KEY ("opportunityId","accountId")
);

-- CreateTable
CREATE TABLE "OpportunityAccountRole" (
    "opportunityId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "role" "OpportunityPartyRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityAccountRole_pkey" PRIMARY KEY ("opportunityId","accountId","role")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_issuer_subject_key" ON "ExternalIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_userId_provider_key" ON "ExternalIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "AccountBusinessRole_role_accountId_idx" ON "AccountBusinessRole"("role", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_name_key" ON "Industry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_name_key" ON "Territory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_name_key" ON "ActivityType"("name");

-- CreateIndex
CREATE INDEX "OpportunityAccount_accountId_opportunityId_idx" ON "OpportunityAccount"("accountId", "opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityAccountRole_role_opportunityId_idx" ON "OpportunityAccountRole"("role", "opportunityId");

-- CreateIndex
CREATE INDEX "Account_name_idx" ON "Account"("name");

-- CreateIndex
CREATE INDEX "Account_ownerId_status_idx" ON "Account"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Account_territory_status_idx" ON "Account"("territory", "status");

-- CreateIndex
CREATE INDEX "Account_industry_idx" ON "Account"("industry");

-- CreateIndex
CREATE INDEX "Account_createdById_idx" ON "Account"("createdById");

-- CreateIndex
CREATE INDEX "Account_updatedById_idx" ON "Account"("updatedById");

-- CreateIndex
CREATE INDEX "Account_archivedById_idx" ON "Account"("archivedById");

-- CreateIndex
CREATE INDEX "Contact_accountId_active_idx" ON "Contact"("accountId", "active");

-- CreateIndex
CREATE INDEX "Contact_createdById_idx" ON "Contact"("createdById");

-- CreateIndex
CREATE INDEX "Contact_updatedById_idx" ON "Contact"("updatedById");

-- CreateIndex
CREATE INDEX "Contact_archivedById_idx" ON "Contact"("archivedById");

-- CreateIndex
CREATE INDEX "SalesStage_active_sortOrder_idx" ON "SalesStage"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_stageId_idx" ON "Opportunity"("ownerId", "stageId");

-- CreateIndex
CREATE INDEX "Opportunity_stageId_expectedCloseDate_idx" ON "Opportunity"("stageId", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "Opportunity_expectedCloseDate_idx" ON "Opportunity"("expectedCloseDate");

-- CreateIndex
CREATE INDEX "Opportunity_currencyCode_idx" ON "Opportunity"("currencyCode");

-- CreateIndex
CREATE INDEX "Opportunity_createdById_idx" ON "Opportunity"("createdById");

-- CreateIndex
CREATE INDEX "Opportunity_updatedById_idx" ON "Opportunity"("updatedById");

-- CreateIndex
CREATE INDEX "Opportunity_archivedById_idx" ON "Opportunity"("archivedById");

-- CreateIndex
CREATE INDEX "OpportunityProduct_opportunityId_archivedAt_idx" ON "OpportunityProduct"("opportunityId", "archivedAt");

-- CreateIndex
CREATE INDEX "OpportunityProduct_productId_idx" ON "OpportunityProduct"("productId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_status_dueDate_idx" ON "Task"("assignedToId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Task_accountId_status_idx" ON "Task"("accountId", "status");

-- CreateIndex
CREATE INDEX "Task_opportunityId_status_idx" ON "Task"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "Task_opportunityId_accountId_idx" ON "Task"("opportunityId", "accountId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Task_updatedById_idx" ON "Task"("updatedById");

-- CreateIndex
CREATE INDEX "Task_archivedById_idx" ON "Task"("archivedById");

-- CreateIndex
CREATE INDEX "Activity_accountId_activityDate_idx" ON "Activity"("accountId", "activityDate");

-- CreateIndex
CREATE INDEX "Activity_opportunityId_activityDate_idx" ON "Activity"("opportunityId", "activityDate");

-- CreateIndex
CREATE INDEX "Activity_userId_activityDate_idx" ON "Activity"("userId", "activityDate");

-- CreateIndex
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- CreateIndex
CREATE INDEX "Activity_opportunityId_accountId_idx" ON "Activity"("opportunityId", "accountId");

-- CreateIndex
CREATE INDEX "Activity_createdById_idx" ON "Activity"("createdById");

-- CreateIndex
CREATE INDEX "Activity_updatedById_idx" ON "Activity"("updatedById");

-- CreateIndex
CREATE INDEX "Activity_archivedById_idx" ON "Activity"("archivedById");

-- CreateIndex
CREATE INDEX "Note_accountId_createdAt_idx" ON "Note"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_opportunityId_createdAt_idx" ON "Note"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_opportunityId_accountId_idx" ON "Note"("opportunityId", "accountId");

-- CreateIndex
CREATE INDEX "Note_createdById_idx" ON "Note"("createdById");

-- CreateIndex
CREATE INDEX "Note_updatedById_idx" ON "Note"("updatedById");

-- CreateIndex
CREATE INDEX "Note_archivedById_idx" ON "Note"("archivedById");

-- Populate new tables only. Preserve existing values, IDs and timestamps verbatim.
-- Existing category strings are stable codes; administrators can change display names later.
INSERT INTO "Industry" ("code", "name", "updatedAt")
SELECT DISTINCT "industry", "industry", CURRENT_TIMESTAMP FROM "Account" WHERE "industry" IS NOT NULL;
INSERT INTO "Territory" ("code", "name", "updatedAt")
SELECT DISTINCT "territory", "territory", CURRENT_TIMESTAMP FROM "Account" WHERE "territory" IS NOT NULL;
INSERT INTO "ActivityType" ("code", "name", "updatedAt")
SELECT DISTINCT "type", "type", CURRENT_TIMESTAMP FROM "Activity";
INSERT INTO "ActivityType" ("code", "name", "sortOrder", "updatedAt") VALUES
  ('CALL', 'CALL', 10, CURRENT_TIMESTAMP),
  ('EMAIL', 'EMAIL', 20, CURRENT_TIMESTAMP),
  ('MEETING', 'MEETING', 30, CURRENT_TIMESTAMP),
  ('OTHER', 'OTHER', 40, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "Currency" ("code", "name", "updatedAt") VALUES ('USD', 'US Dollar', CURRENT_TIMESTAMP);
INSERT INTO "AccountBusinessRole" ("accountId", "role", "createdAt", "updatedAt")
SELECT "id", "accountType"::"AccountBusinessRoleCode", "createdAt", "updatedAt"
FROM "Account" WHERE "accountType" IS NOT NULL;
INSERT INTO "OpportunityAccount" ("opportunityId", "accountId", "createdAt", "updatedAt")
SELECT "id", "accountId", "createdAt", "updatedAt" FROM "Opportunity" WHERE "accountId" IS NOT NULL;
-- Do not guess an opportunity participant's role from its general account classification.

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_industry_fkey" FOREIGN KEY ("industry") REFERENCES "Industry"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_territory_fkey" FOREIGN KEY ("territory") REFERENCES "Territory"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBusinessRole" ADD CONSTRAINT "AccountBusinessRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAccount" ADD CONSTRAINT "OpportunityAccount_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAccount" ADD CONSTRAINT "OpportunityAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAccountRole" ADD CONSTRAINT "OpportunityAccountRole_opportunityId_accountId_fkey" FOREIGN KEY ("opportunityId", "accountId") REFERENCES "OpportunityAccount"("opportunityId", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_opportunityId_accountId_fkey" FOREIGN KEY ("opportunityId", "accountId") REFERENCES "OpportunityAccount"("opportunityId", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_accountId_fkey" FOREIGN KEY ("opportunityId", "accountId") REFERENCES "OpportunityAccount"("opportunityId", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_type_fkey" FOREIGN KEY ("type") REFERENCES "ActivityType"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_opportunityId_accountId_fkey" FOREIGN KEY ("opportunityId", "accountId") REFERENCES "OpportunityAccount"("opportunityId", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma 6.19.3 does not express these CHECKs or the partial unique index.
CREATE UNIQUE INDEX "Contact_one_primary_per_account" ON "Contact" ("accountId") WHERE "isPrimary";
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_primary_active_check"
  CHECK (NOT "isPrimary" OR ("active" AND "archivedAt" IS NULL));
ALTER TABLE "Account" ADD CONSTRAINT "Account_archive_state_check"
  CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));
ALTER TABLE "User" ADD CONSTRAINT "User_archive_inactive_check"
  CHECK ("archivedAt" IS NULL OR NOT "active");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_archive_inactive_check"
  CHECK ("archivedAt" IS NULL OR NOT "active");
ALTER TABLE "Product" ADD CONSTRAINT "Product_archive_inactive_check"
  CHECK ("archivedAt" IS NULL OR NOT "active");
ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_probability_check" CHECK ("probability" BETWEEN 0 AND 100),
  ADD CONSTRAINT "SalesStage_sort_order_check" CHECK ("sortOrder" >= 0),
  ADD CONSTRAINT "SalesStage_state_check" CHECK (
    (NOT "isWon" OR "isClosed") AND
    (NOT "isClosed" OR ("isWon" AND "probability" = 100) OR (NOT "isWon" AND "probability" = 0))
  );
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_probability_check"
  CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 100);
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "OpportunityProduct_price_check" CHECK ("unitPrice" >= 0 AND "unitPrice" <> 'NaN'::numeric);
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_parent_check"
  CHECK ("accountId" IS NOT NULL OR "opportunityId" IS NOT NULL);
ALTER TABLE "Note" ADD CONSTRAINT "Note_parent_check"
  CHECK ("accountId" IS NOT NULL OR "opportunityId" IS NOT NULL);
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_sort_order_check" CHECK ("sortOrder" >= 0);
ALTER TABLE "Territory" ADD CONSTRAINT "Territory_sort_order_check" CHECK ("sortOrder" >= 0);
ALTER TABLE "ActivityType" ADD CONSTRAINT "ActivityType_sort_order_check" CHECK ("sortOrder" >= 0);
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_code_check" CHECK ("code"::text ~ '^[A-Z]{3}$');
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_nonempty_check"
  CHECK (length(btrim("issuer")) > 0 AND length(btrim("subject")) > 0);

COMMIT;
