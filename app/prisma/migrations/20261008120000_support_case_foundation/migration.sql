-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('NEW', 'OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_INTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupportCaseSource" AS ENUM ('PHONE', 'EMAIL', 'WEB', 'INTERNAL_REFERRAL', 'OTHER');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPPORT';

-- CreateTable
CREATE TABLE "SupportCaseCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCaseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCaseNumberCounter" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,

    CONSTRAINT "SupportCaseNumberCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" SERIAL NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'NEW',
    "priority" "SupportCasePriority" NOT NULL DEFAULT 'NORMAL',
    "categoryId" INTEGER,
    "assignedToId" INTEGER,
    "productSkuId" INTEGER,
    "serialNumber" TEXT,
    "source" "SupportCaseSource" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextFollowUpAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolutionSummary" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCaseLifecycleEvent" (
    "id" SERIAL NOT NULL,
    "supportCaseId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "oldLabel" TEXT,
    "newLabel" TEXT,
    "actorId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CRM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportCaseCategory_name_key" ON "SupportCaseCategory"("name");

-- CreateIndex
CREATE INDEX "SupportCaseCategory_active_sortOrder_idx" ON "SupportCaseCategory"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_caseNumber_key" ON "SupportCase"("caseNumber");

-- CreateIndex
CREATE INDEX "SupportCase_accountId_openedAt_idx" ON "SupportCase"("accountId", "openedAt");

-- CreateIndex
CREATE INDEX "SupportCase_assignedToId_status_idx" ON "SupportCase"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "SupportCase_status_priority_idx" ON "SupportCase"("status", "priority");

-- CreateIndex
CREATE INDEX "SupportCase_categoryId_idx" ON "SupportCase"("categoryId");

-- CreateIndex
CREATE INDEX "SupportCase_productSkuId_idx" ON "SupportCase"("productSkuId");

-- CreateIndex
CREATE INDEX "SupportCase_nextFollowUpAt_idx" ON "SupportCase"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "SupportCase_archivedAt_idx" ON "SupportCase"("archivedAt");

-- CreateIndex
CREATE INDEX "SupportCaseLifecycleEvent_supportCaseId_createdAt_id_idx" ON "SupportCaseLifecycleEvent"("supportCaseId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCaseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_productSkuId_fkey" FOREIGN KEY ("productSkuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCaseLifecycleEvent" ADD CONSTRAINT "SupportCaseLifecycleEvent_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCaseLifecycleEvent" ADD CONSTRAINT "SupportCaseLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve external identifiers and make lifecycle rows append-only, including for
-- future callers outside the application service.
CREATE FUNCTION support_case_immutable_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."caseNumber" IS DISTINCT FROM OLD."caseNumber" THEN
    RAISE EXCEPTION 'Support Case number is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_case_immutable_number BEFORE UPDATE ON "SupportCase"
FOR EACH ROW EXECUTE FUNCTION support_case_immutable_number();

CREATE FUNCTION support_case_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Support Case lifecycle history is append-only';
END;
$$;
CREATE TRIGGER support_case_event_append_only BEFORE UPDATE OR DELETE ON "SupportCaseLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION support_case_event_append_only();

ALTER TABLE "SupportCaseNumberCounter" ADD CONSTRAINT "SupportCaseNumberCounter_positive_check" CHECK ("year" BETWEEN 2000 AND 9999 AND "lastNumber" > 0);
ALTER TABLE "SupportCaseCategory" ADD CONSTRAINT "SupportCaseCategory_sortOrder_check" CHECK ("sortOrder" >= 0);
