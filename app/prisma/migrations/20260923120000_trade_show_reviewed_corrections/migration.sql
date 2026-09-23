ALTER TABLE "TradeShowLead"
ADD COLUMN "reviewedOverrides" JSONB,
ADD COLUMN "sourceOriginalKey" TEXT;

CREATE INDEX "TradeShowLead_tradeShowId_sourceOriginalKey_idx"
ON "TradeShowLead"("tradeShowId", "sourceOriginalKey");
