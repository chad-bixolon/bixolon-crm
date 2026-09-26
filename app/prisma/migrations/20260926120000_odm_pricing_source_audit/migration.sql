CREATE TABLE "OdmPricingImportSource" (
    "id" SERIAL NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "workbook" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "resolution" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdmPricingImportSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OdmPricingImportSource_sourceKey_key" ON "OdmPricingImportSource"("sourceKey");
CREATE INDEX "OdmPricingImportSource_workbook_sheet_rowNumber_idx" ON "OdmPricingImportSource"("workbook", "sheet", "rowNumber");
