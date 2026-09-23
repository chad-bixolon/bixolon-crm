ALTER TYPE "TradeShowImportFormat" ADD VALUE 'CUSTOM_MAPPING';

CREATE TABLE "TradeShowImportMapping" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "headerFingerprint" TEXT NOT NULL,
    "mappings" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradeShowImportMapping_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TradeShowImport"
  ADD COLUMN "mappingId" INTEGER,
  ADD COLUMN "mappingName" TEXT;

CREATE INDEX "TradeShowImportMapping_headerFingerprint_archivedAt_idx" ON "TradeShowImportMapping"("headerFingerprint", "archivedAt");
CREATE INDEX "TradeShowImportMapping_archivedAt_name_idx" ON "TradeShowImportMapping"("archivedAt", "name");
CREATE INDEX "TradeShowImport_mappingId_idx" ON "TradeShowImport"("mappingId");

ALTER TABLE "TradeShowImportMapping" ADD CONSTRAINT "TradeShowImportMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeShowImportMapping" ADD CONSTRAINT "TradeShowImportMapping_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeShowImport" ADD CONSTRAINT "TradeShowImport_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "TradeShowImportMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
