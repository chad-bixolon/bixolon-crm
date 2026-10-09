CREATE TABLE "SupportCaseAttachment" (
  "id" SERIAL PRIMARY KEY,
  "supportCaseId" INTEGER NOT NULL REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "originalFileName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "uploadedByUserId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "deletedByUserId" INTEGER REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupportCaseAttachment_size_check" CHECK ("fileSizeBytes" > 0 AND "fileSizeBytes" <= 26214400),
  CONSTRAINT "SupportCaseAttachment_name_check" CHECK (length(btrim("originalFileName")) > 0),
  CONSTRAINT "SupportCaseAttachment_delete_attribution_check" CHECK (("deletedAt" IS NULL) = ("deletedByUserId" IS NULL))
);
CREATE UNIQUE INDEX "SupportCaseAttachment_storageKey_key" ON "SupportCaseAttachment"("storageKey");
CREATE INDEX "SupportCaseAttachment_supportCaseId_createdAt_idx" ON "SupportCaseAttachment"("supportCaseId", "createdAt");
CREATE INDEX "SupportCaseAttachment_supportCaseId_deletedAt_createdAt_idx" ON "SupportCaseAttachment"("supportCaseId", "deletedAt", "createdAt");
