ALTER TABLE "TradeShow" ADD COLUMN "boothNumber" TEXT;

CREATE TABLE "TradeShowResourceLink" (
    "id" SERIAL NOT NULL,
    "tradeShowId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradeShowResourceLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeShowResourceLink_tradeShowId_sortOrder_idx" ON "TradeShowResourceLink"("tradeShowId", "sortOrder");

ALTER TABLE "TradeShowResourceLink" ADD CONSTRAINT "TradeShowResourceLink_tradeShowId_fkey" FOREIGN KEY ("tradeShowId") REFERENCES "TradeShow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
