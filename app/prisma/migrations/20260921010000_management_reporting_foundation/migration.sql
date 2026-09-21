CREATE TYPE "ReportType" AS ENUM ('PIPELINE', 'ACCOUNT_ACTIVITY', 'PRODUCT_PERFORMANCE', 'CHANNEL_PARTNER', 'PROJECT_INITIATIVE', 'PRICE_EXCEPTION_USAGE');

CREATE TYPE "ReportVisibility" AS ENUM ('PERSONAL', 'SHARED');

CREATE TABLE "ReportDefinition" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "reportType" "ReportType" NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "visibility" "ReportVisibility" NOT NULL DEFAULT 'PERSONAL',
  "configuration" JSONB NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdById" INTEGER NOT NULL,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportDefinition_ownerId_archivedAt_idx" ON "ReportDefinition"("ownerId", "archivedAt");
CREATE INDEX "ReportDefinition_visibility_reportType_archivedAt_idx" ON "ReportDefinition"("visibility", "reportType", "archivedAt");
CREATE INDEX "ReportDefinition_createdById_idx" ON "ReportDefinition"("createdById");
CREATE INDEX "ReportDefinition_updatedById_idx" ON "ReportDefinition"("updatedById");

ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
