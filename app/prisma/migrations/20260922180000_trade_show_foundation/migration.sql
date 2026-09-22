-- CreateEnum
CREATE TYPE "TradeShowLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TradeShowImportFormat" AS ENUM ('NRA_NRF', 'XPRESSLEADS_MODEX');

-- CreateTable
CREATE TABLE "TradeShow" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "location" TEXT,
    "timezone" TEXT,
    "description" TEXT,
    "marketingOwnerId" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "archivedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeShow_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TradeShow" ADD CONSTRAINT "TradeShow_dates_check"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate");

-- CreateTable
CREATE TABLE "TradeShowImport" (
    "id" SERIAL NOT NULL,
    "tradeShowId" INTEGER NOT NULL,
    "format" "TradeShowImportFormat" NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "existingCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeShowImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeShowLead" (
    "id" SERIAL NOT NULL,
    "tradeShowId" INTEGER NOT NULL,
    "firstImportId" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceLeadId" TEXT,
    "sourceFileName" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawSourceData" JSONB NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "sourceCompany" TEXT,
    "sourceCompanyWebsite" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "sourceNotes" TEXT,
    "productInterest" TEXT,
    "competitorSourceText" TEXT,
    "competitorId" INTEGER,
    "currentProductBeingUsed" TEXT,
    "customerPainPoints" TEXT,
    "assignedSalesRepUserId" INTEGER,
    "status" "TradeShowLeadStatus" NOT NULL DEFAULT 'NEW',
    "followUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "salesNotes" TEXT,
    "accountId" INTEGER,
    "contactId" INTEGER,
    "convertedOpportunityId" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeShowLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeShow_archivedAt_startDate_idx" ON "TradeShow"("archivedAt", "startDate");

-- CreateIndex
CREATE INDEX "TradeShow_marketingOwnerId_idx" ON "TradeShow"("marketingOwnerId");

-- CreateIndex
CREATE INDEX "TradeShowImport_tradeShowId_uploadedAt_idx" ON "TradeShowImport"("tradeShowId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeShowImport_id_tradeShowId_key" ON "TradeShowImport"("id", "tradeShowId");

-- CreateIndex
CREATE INDEX "TradeShowLead_tradeShowId_status_idx" ON "TradeShowLead"("tradeShowId", "status");

-- CreateIndex
CREATE INDEX "TradeShowLead_assignedSalesRepUserId_status_idx" ON "TradeShowLead"("assignedSalesRepUserId", "status");

-- CreateIndex
CREATE INDEX "TradeShowLead_email_idx" ON "TradeShowLead"("email");

-- CreateIndex
CREATE INDEX "TradeShowLead_accountId_idx" ON "TradeShowLead"("accountId");

-- CreateIndex
CREATE INDEX "TradeShowLead_contactId_idx" ON "TradeShowLead"("contactId");

-- CreateIndex
CREATE INDEX "TradeShowLead_convertedOpportunityId_idx" ON "TradeShowLead"("convertedOpportunityId");

-- CreateIndex
CREATE INDEX "TradeShowLead_firstImportId_idx" ON "TradeShowLead"("firstImportId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeShowLead_tradeShowId_sourceKey_key" ON "TradeShowLead"("tradeShowId", "sourceKey");

-- AddForeignKey
ALTER TABLE "TradeShow" ADD CONSTRAINT "TradeShow_marketingOwnerId_fkey" FOREIGN KEY ("marketingOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShow" ADD CONSTRAINT "TradeShow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShow" ADD CONSTRAINT "TradeShow_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShow" ADD CONSTRAINT "TradeShow_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowImport" ADD CONSTRAINT "TradeShowImport_tradeShowId_fkey" FOREIGN KEY ("tradeShowId") REFERENCES "TradeShow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowImport" ADD CONSTRAINT "TradeShowImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_tradeShowId_fkey" FOREIGN KEY ("tradeShowId") REFERENCES "TradeShow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_firstImportId_tradeShowId_fkey" FOREIGN KEY ("firstImportId", "tradeShowId") REFERENCES "TradeShowImport"("id", "tradeShowId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "CompetitorOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_assignedSalesRepUserId_fkey" FOREIGN KEY ("assignedSalesRepUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_convertedOpportunityId_fkey" FOREIGN KEY ("convertedOpportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
