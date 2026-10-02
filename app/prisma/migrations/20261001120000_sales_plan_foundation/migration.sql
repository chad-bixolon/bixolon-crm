-- CreateEnum
CREATE TYPE "SalesPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "SalesPlan" (
    "id" SERIAL NOT NULL,
    "planYear" INTEGER NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "originalOwnerName" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "SalesPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceFileName" VARCHAR(255) NOT NULL,
    "sourceSha256" CHAR(64) NOT NULL,
    "importFingerprint" CHAR(64) NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededById" INTEGER,

    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlanLine" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "originalSalesRepName" VARCHAR(255),
    "accountId" INTEGER,
    "originalAccountText" VARCHAR(500),
    "accountCarryForwardSuggested" BOOLEAN NOT NULL DEFAULT false,
    "productSkuId" INTEGER,
    "originalSkuText" VARCHAR(500),
    "planItem" VARCHAR(1000),
    "annualPlannedUnits" DECIMAL(18,3),
    "annualPlannedRevenue" DECIMAL(18,2),
    "priorYearRevenue" DECIMAL(18,2),
    "comments" TEXT,
    "sourceWorksheet" VARCHAR(255) NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlanQuarterAllocation" (
    "id" SERIAL NOT NULL,
    "salesPlanLineId" INTEGER NOT NULL,
    "quarter" "SalesQuarter" NOT NULL,
    "plannedUnits" DECIMAL(18,3),
    "plannedRevenue" DECIMAL(18,2),
    "updatedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlanQuarterAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_importFingerprint_key" ON "SalesPlan"("importFingerprint");

-- CreateIndex
CREATE INDEX "SalesPlan_planYear_currencyCode_status_idx" ON "SalesPlan"("planYear", "currencyCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_ownerId_planYear_currencyCode_revision_key" ON "SalesPlan"("ownerId", "planYear", "currencyCode", "revision");

-- CreateIndex
CREATE INDEX "SalesPlanLine_accountId_idx" ON "SalesPlanLine"("accountId");

-- CreateIndex
CREATE INDEX "SalesPlanLine_productSkuId_idx" ON "SalesPlanLine"("productSkuId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlanLine_planId_sourceWorksheet_sourceRow_key" ON "SalesPlanLine"("planId", "sourceWorksheet", "sourceRow");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlanQuarterAllocation_salesPlanLineId_quarter_key" ON "SalesPlanQuarterAllocation"("salesPlanLineId", "quarter");

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_productSkuId_fkey" FOREIGN KEY ("productSkuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanQuarterAllocation" ADD CONSTRAINT "SalesPlanQuarterAllocation_salesPlanLineId_fkey" FOREIGN KEY ("salesPlanLineId") REFERENCES "SalesPlanLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanQuarterAllocation" ADD CONSTRAINT "SalesPlanQuarterAllocation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SalesPlan_active_owner_year_currency_key" ON "SalesPlan"("ownerId", "planYear", "currencyCode") WHERE "status" = 'ACTIVE';
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_year_check" CHECK ("planYear" BETWEEN 2000 AND 2100);
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_nonnegative_check" CHECK (("annualPlannedUnits" IS NULL OR "annualPlannedUnits" >= 0) AND ("annualPlannedRevenue" IS NULL OR "annualPlannedRevenue" >= 0) AND ("priorYearRevenue" IS NULL OR "priorYearRevenue" >= 0));
ALTER TABLE "SalesPlanQuarterAllocation" ADD CONSTRAINT "SalesPlanQuarterAllocation_nonnegative_check" CHECK (("plannedUnits" IS NULL OR "plannedUnits" >= 0) AND ("plannedRevenue" IS NULL OR "plannedRevenue" >= 0));
-- CreateTable
CREATE TABLE "SalesPlanImportMapping" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "mappings" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlanImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesPlanImportMapping_archivedAt_name_idx" ON "SalesPlanImportMapping"("archivedAt", "name");

-- AddForeignKey
ALTER TABLE "SalesPlanImportMapping" ADD CONSTRAINT "SalesPlanImportMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

