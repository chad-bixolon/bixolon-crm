BEGIN;
-- Legacy assignments retain NULL and continue to resolve through the existing fallback.
ALTER TABLE "TradeShowLead" ADD COLUMN "partnerFollowUpOwnerId" INTEGER;
ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_partnerFollowUpOwnerId_fkey"
  FOREIGN KEY ("partnerFollowUpOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TradeShowLead_partnerFollowUpOwnerId_idx" ON "TradeShowLead"("partnerFollowUpOwnerId");
COMMIT;
