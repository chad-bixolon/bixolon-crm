CREATE TYPE "TradeShowLeadRouting" AS ENUM (
  'UNREVIEWED',
  'BIXOLON_SALES',
  'REFERRED_TO_PARTNER',
  'MARKETING_FOLLOW_UP'
);

ALTER TABLE "TradeShowLead"
  ADD COLUMN "routing" "TradeShowLeadRouting" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "routedPartnerAccountId" INTEGER,
  ADD COLUMN "referredAt" TIMESTAMP(3),
  ADD COLUMN "referredByUserId" INTEGER,
  ADD COLUMN "referralNotes" TEXT,
  ADD CONSTRAINT "TradeShowLead_routing_requirements_check" CHECK (
    ("routing" <> 'BIXOLON_SALES' OR "assignedSalesRepUserId" IS NOT NULL)
    AND ("routing" <> 'REFERRED_TO_PARTNER' OR "routedPartnerAccountId" IS NOT NULL)
  );

CREATE INDEX "TradeShowLead_tradeShowId_routing_idx" ON "TradeShowLead"("tradeShowId", "routing");
CREATE INDEX "TradeShowLead_routedPartnerAccountId_routing_idx" ON "TradeShowLead"("routedPartnerAccountId", "routing");
CREATE INDEX "TradeShowLead_referredByUserId_idx" ON "TradeShowLead"("referredByUserId");

ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_routedPartnerAccountId_fkey"
  FOREIGN KEY ("routedPartnerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_referredByUserId_fkey"
  FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
