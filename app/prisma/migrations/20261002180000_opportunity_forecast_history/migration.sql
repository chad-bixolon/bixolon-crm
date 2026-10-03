-- CreateTable
CREATE TABLE "OpportunityHistoryEvent" (
    "id" SERIAL NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER,
    "eventType" VARCHAR(32) NOT NULL,
    "opportunityName" TEXT NOT NULL,
    "actorName" TEXT,
    "accountName" TEXT,
    "oldStageId" INTEGER,
    "newStageId" INTEGER,
    "oldStageName" TEXT,
    "newStageName" TEXT,
    "oldCategory" "ForecastCategory",
    "newCategory" "ForecastCategory",
    "oldCloseDate" TIMESTAMP(3),
    "newCloseDate" TIMESTAMP(3),
    "oldOwnerId" INTEGER,
    "newOwnerId" INTEGER,
    "oldOwnerName" TEXT,
    "newOwnerName" TEXT,
    "oldProbability" INTEGER,
    "newProbability" INTEGER,
    "oldValue" DECIMAL(18,2),
    "newValue" DECIMAL(18,2),
    "oldCurrencyCode" CHAR(3),
    "newCurrencyCode" CHAR(3),
    "oldArchived" BOOLEAN,
    "newArchived" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityHistoryArchive" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" INTEGER,
    "eventType" VARCHAR(32) NOT NULL,
    "opportunityName" TEXT NOT NULL,
    "actorName" TEXT,
    "accountName" TEXT,
    "oldStageId" INTEGER,
    "newStageId" INTEGER,
    "oldStageName" TEXT,
    "newStageName" TEXT,
    "oldCategory" "ForecastCategory",
    "newCategory" "ForecastCategory",
    "oldCloseDate" TIMESTAMP(3),
    "newCloseDate" TIMESTAMP(3),
    "oldOwnerId" INTEGER,
    "newOwnerId" INTEGER,
    "oldOwnerName" TEXT,
    "newOwnerName" TEXT,
    "oldProbability" INTEGER,
    "newProbability" INTEGER,
    "oldValue" DECIMAL(18,2),
    "newValue" DECIMAL(18,2),
    "oldCurrencyCode" CHAR(3),
    "newCurrencyCode" CHAR(3),
    "oldArchived" BOOLEAN,
    "newArchived" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archiveBatchId" UUID NOT NULL,

    CONSTRAINT "OpportunityHistoryArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" SERIAL NOT NULL,
    "snapshotWeek" DATE NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "year" INTEGER NOT NULL,
    "quarter" "SalesQuarter" NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "repId" INTEGER NOT NULL,
    "repName" TEXT NOT NULL,
    "pipeline" DECIMAL(18,2) NOT NULL,
    "weightedPipeline" DECIMAL(18,2) NOT NULL,
    "bestCase" DECIMAL(18,2) NOT NULL,
    "commit" DECIMAL(18,2) NOT NULL,
    "target" DECIMAL(18,2),
    "targetStatus" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshotArchive" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "snapshotWeek" DATE NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" "SalesQuarter" NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "repId" INTEGER NOT NULL,
    "repName" TEXT NOT NULL,
    "pipeline" DECIMAL(18,2) NOT NULL,
    "weightedPipeline" DECIMAL(18,2) NOT NULL,
    "bestCase" DECIMAL(18,2) NOT NULL,
    "commit" DECIMAL(18,2) NOT NULL,
    "target" DECIMAL(18,2),
    "targetStatus" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archiveBatchId" UUID NOT NULL,

    CONSTRAINT "ForecastSnapshotArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpportunityHistoryEvent_opportunityId_occurredAt_id_idx" ON "OpportunityHistoryEvent"("opportunityId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "OpportunityHistoryEvent_actorId_occurredAt_idx" ON "OpportunityHistoryEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "OpportunityHistoryEvent_eventType_occurredAt_idx" ON "OpportunityHistoryEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "OpportunityHistoryEvent_oldCloseDate_newCloseDate_idx" ON "OpportunityHistoryEvent"("oldCloseDate", "newCloseDate");

-- CreateIndex
CREATE INDEX "OpportunityHistoryEvent_newCategory_occurredAt_idx" ON "OpportunityHistoryEvent"("newCategory", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityHistoryArchive_sourceId_key" ON "OpportunityHistoryArchive"("sourceId");

-- CreateIndex
CREATE INDEX "OpportunityHistoryArchive_opportunityId_occurredAt_sourceId_idx" ON "OpportunityHistoryArchive"("opportunityId", "occurredAt", "sourceId");

-- CreateIndex
CREATE INDEX "OpportunityHistoryArchive_archiveBatchId_idx" ON "OpportunityHistoryArchive"("archiveBatchId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_year_quarter_currencyCode_repId_snapshotWe_idx" ON "ForecastSnapshot"("year", "quarter", "currencyCode", "repId", "snapshotWeek");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_capturedAt_idx" ON "ForecastSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_snapshotWeek_year_quarter_currencyCode_rep_key" ON "ForecastSnapshot"("snapshotWeek", "year", "quarter", "currencyCode", "repId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshotArchive_sourceId_key" ON "ForecastSnapshotArchive"("sourceId");

-- CreateIndex
CREATE INDEX "ForecastSnapshotArchive_year_quarter_currencyCode_repId_sna_idx" ON "ForecastSnapshotArchive"("year", "quarter", "currencyCode", "repId", "snapshotWeek");

-- CreateIndex
CREATE INDEX "ForecastSnapshotArchive_archiveBatchId_idx" ON "ForecastSnapshotArchive"("archiveBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshotArchive_snapshotWeek_year_quarter_currencyC_key" ON "ForecastSnapshotArchive"("snapshotWeek", "year", "quarter", "currencyCode", "repId");

-- AddForeignKey
ALTER TABLE "OpportunityHistoryEvent" ADD CONSTRAINT "OpportunityHistoryEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

