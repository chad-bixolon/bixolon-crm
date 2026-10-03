-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "leadSourceId" INTEGER;

-- AlterTable
ALTER TABLE "TradeShowLead" ADD COLUMN     "leadSourceId" INTEGER;

-- CreateTable
CREATE TABLE "LeadSourceOption" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSourceOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceChange" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER,
    "tradeShowLeadId" INTEGER,
    "oldSourceId" INTEGER,
    "newSourceId" INTEGER,
    "actorId" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSourceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "endDate" DATE,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "tradeShowId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignInfluence" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "tradeShowLeadId" INTEGER,
    "contactId" INTEGER,
    "opportunityId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceContext" TEXT NOT NULL,
    "sourceKey" TEXT,
    "metadata" JSONB,
    "notes" TEXT,
    "capturedById" INTEGER,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignInfluence_pkey" PRIMARY KEY ("id")
);

-- A touch belongs to one originating record; linked Contacts and Opportunities are resolved at read time.
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_one_origin_check"
  CHECK (("tradeShowLeadId" IS NOT NULL)::int + ("contactId" IS NOT NULL)::int + ("opportunityId" IS NOT NULL)::int = 1);
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_one_target_check"
  CHECK (("tradeShowLeadId" IS NOT NULL)::int + ("contactId" IS NOT NULL)::int = 1);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceOption_name_key" ON "LeadSourceOption"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceOption_systemKey_key" ON "LeadSourceOption"("systemKey");

-- CreateIndex
CREATE INDEX "LeadSourceOption_active_sortOrder_idx" ON "LeadSourceOption"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "LeadSourceChange_contactId_createdAt_idx" ON "LeadSourceChange"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadSourceChange_tradeShowLeadId_createdAt_idx" ON "LeadSourceChange"("tradeShowLeadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_tradeShowId_key" ON "MarketingCampaign"("tradeShowId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_archivedAt_year_idx" ON "MarketingCampaign"("archivedAt", "year");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_startDate_idx" ON "MarketingCampaign"("status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignInfluence_sourceKey_key" ON "CampaignInfluence"("sourceKey");

-- CreateIndex
CREATE INDEX "CampaignInfluence_campaignId_occurredAt_idx" ON "CampaignInfluence"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignInfluence_tradeShowLeadId_occurredAt_idx" ON "CampaignInfluence"("tradeShowLeadId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignInfluence_contactId_occurredAt_idx" ON "CampaignInfluence"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignInfluence_opportunityId_occurredAt_idx" ON "CampaignInfluence"("opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignInfluence_voidedById_idx" ON "CampaignInfluence"("voidedById");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "LeadSourceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "LeadSourceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_tradeShowLeadId_fkey" FOREIGN KEY ("tradeShowLeadId") REFERENCES "TradeShowLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_oldSourceId_fkey" FOREIGN KEY ("oldSourceId") REFERENCES "LeadSourceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_newSourceId_fkey" FOREIGN KEY ("newSourceId") REFERENCES "LeadSourceOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceChange" ADD CONSTRAINT "LeadSourceChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_tradeShowId_fkey" FOREIGN KEY ("tradeShowId") REFERENCES "TradeShow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_tradeShowLeadId_fkey" FOREIGN KEY ("tradeShowLeadId") REFERENCES "TradeShowLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInfluence" ADD CONSTRAINT "CampaignInfluence_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- This is the configurable default for new Trade Show activity, not a historical backfill.
INSERT INTO "LeadSourceOption" ("name", "systemKey", "active", "sortOrder", "updatedAt")
VALUES ('Events', 'TRADE_SHOW_EVENT', true, 10, CURRENT_TIMESTAMP);
