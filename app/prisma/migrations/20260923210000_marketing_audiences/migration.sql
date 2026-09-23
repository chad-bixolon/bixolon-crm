-- Marketing Preference is explicit and defaults to UNKNOWN for every existing and future Contact.
CREATE TYPE "MarketingPreference" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');
CREATE TYPE "MarketingAudienceContactOverrideKind" AS ENUM ('INCLUDE', 'EXCLUDE');

ALTER TABLE "Contact"
  ADD COLUMN "marketingPreference" "MarketingPreference" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "marketingPreferenceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "marketingPreferenceUpdatedByUserId" INTEGER;

CREATE TABLE "MarketingAudience" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerId" INTEGER NOT NULL,
  "visibility" "ReportVisibility" NOT NULL DEFAULT 'PERSONAL',
  "filterConfig" JSONB NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdById" INTEGER NOT NULL,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingAudienceContactOverride" (
  "audienceId" INTEGER NOT NULL,
  "contactId" INTEGER NOT NULL,
  "kind" "MarketingAudienceContactOverrideKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingAudienceContactOverride_pkey" PRIMARY KEY ("audienceId", "contactId")
);

CREATE INDEX "Contact_marketingPreference_active_archivedAt_idx" ON "Contact"("marketingPreference", "active", "archivedAt");
CREATE INDEX "Contact_marketingPreferenceUpdatedByUserId_idx" ON "Contact"("marketingPreferenceUpdatedByUserId");
CREATE INDEX "MarketingAudience_ownerId_archivedAt_idx" ON "MarketingAudience"("ownerId", "archivedAt");
CREATE INDEX "MarketingAudience_visibility_archivedAt_idx" ON "MarketingAudience"("visibility", "archivedAt");
CREATE INDEX "MarketingAudience_createdById_idx" ON "MarketingAudience"("createdById");
CREATE INDEX "MarketingAudience_updatedById_idx" ON "MarketingAudience"("updatedById");
CREATE INDEX "MarketingAudienceContactOverride_contactId_audienceId_idx" ON "MarketingAudienceContactOverride"("contactId", "audienceId");
CREATE INDEX "MarketingAudienceContactOverride_audienceId_kind_idx" ON "MarketingAudienceContactOverride"("audienceId", "kind");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_marketingPreferenceUpdatedByUserId_fkey" FOREIGN KEY ("marketingPreferenceUpdatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAudience" ADD CONSTRAINT "MarketingAudience_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAudience" ADD CONSTRAINT "MarketingAudience_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAudience" ADD CONSTRAINT "MarketingAudience_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAudienceContactOverride" ADD CONSTRAINT "MarketingAudienceContactOverride_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "MarketingAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingAudienceContactOverride" ADD CONSTRAINT "MarketingAudienceContactOverride_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
