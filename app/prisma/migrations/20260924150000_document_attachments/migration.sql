-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('QUOTE', 'STATEMENT_OF_WORK', 'CONTRACT', 'ADDENDUM', 'PROPOSAL', 'NDA', 'TECHNICAL_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "description" TEXT,
    "uploadedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "accountId" INTEGER,
    "projectId" INTEGER,
    "opportunityId" INTEGER,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Document_exactly_one_parent_check" CHECK (num_nonnulls("accountId", "projectId", "opportunityId") = 1),
    CONSTRAINT "Document_file_size_check" CHECK ("fileSize" > 0 AND "fileSize" <= 26214400),
    CONSTRAINT "Document_original_file_name_check" CHECK (length(btrim("originalFileName")) > 0),
    CONSTRAINT "Document_archive_attribution_check" CHECK (("archivedAt" IS NULL) = ("archivedByUserId" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_accountId_archivedAt_createdAt_idx" ON "Document"("accountId", "archivedAt", "createdAt");
CREATE INDEX "Document_projectId_archivedAt_createdAt_idx" ON "Document"("projectId", "archivedAt", "createdAt");
CREATE INDEX "Document_opportunityId_archivedAt_createdAt_idx" ON "Document"("opportunityId", "archivedAt", "createdAt");
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");
CREATE INDEX "Document_archivedAt_idx" ON "Document"("archivedAt");
CREATE INDEX "Document_uploadedByUserId_idx" ON "Document"("uploadedByUserId");
CREATE INDEX "Document_archivedByUserId_idx" ON "Document"("archivedByUserId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
