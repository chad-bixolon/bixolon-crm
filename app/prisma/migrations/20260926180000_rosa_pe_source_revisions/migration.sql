CREATE TABLE "PriceExceptionSourceRevision" (
    "id" SERIAL NOT NULL,
    "priceExceptionId" INTEGER NOT NULL,
    "peNumber" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceReviewedAt" TIMESTAMP(3) NOT NULL,
    "rawRows" JSONB NOT NULL,
    "reviewedChoices" JSONB NOT NULL,
    "resolvedHeader" JSONB NOT NULL,
    "resolvedTiers" JSONB NOT NULL,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceExceptionSourceRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PriceException" ADD COLUMN "currentSourceRevisionId" INTEGER;
ALTER TABLE "PriceExceptionLine" ADD COLUMN "sourceRevisionId" INTEGER;
ALTER TABLE "PriceExceptionLine" ADD COLUMN "retiredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PriceException_currentSourceRevisionId_key" ON "PriceException"("currentSourceRevisionId");
CREATE UNIQUE INDEX "PriceException_currentSourceRevisionId_id_key" ON "PriceException"("currentSourceRevisionId", "id");
CREATE UNIQUE INDEX "PriceExceptionSourceRevision_priceExceptionId_contentHash_key" ON "PriceExceptionSourceRevision"("priceExceptionId", "contentHash");
CREATE UNIQUE INDEX "PriceExceptionSourceRevision_id_priceExceptionId_key" ON "PriceExceptionSourceRevision"("id", "priceExceptionId");
CREATE INDEX "PriceExceptionSourceRevision_priceExceptionId_sourceReviewedAt_idx" ON "PriceExceptionSourceRevision"("priceExceptionId", "sourceReviewedAt");
CREATE INDEX "PriceExceptionLine_priceExceptionId_retiredAt_sortOrder_idx" ON "PriceExceptionLine"("priceExceptionId", "retiredAt", "sortOrder");

ALTER TABLE "PriceExceptionSourceRevision" ADD CONSTRAINT "PriceExceptionSourceRevision_priceExceptionId_fkey" FOREIGN KEY ("priceExceptionId") REFERENCES "PriceException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionSourceRevision" ADD CONSTRAINT "PriceExceptionSourceRevision_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_currentSourceRevisionId_id_fkey" FOREIGN KEY ("currentSourceRevisionId", "id") REFERENCES "PriceExceptionSourceRevision"("id", "priceExceptionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionLine" ADD CONSTRAINT "PriceExceptionLine_sourceRevisionId_priceExceptionId_fkey" FOREIGN KEY ("sourceRevisionId", "priceExceptionId") REFERENCES "PriceExceptionSourceRevision"("id", "priceExceptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_pe_source_revision_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Price Exception source revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PriceExceptionSourceRevision_append_only"
BEFORE UPDATE OR DELETE ON "PriceExceptionSourceRevision"
FOR EACH ROW EXECUTE FUNCTION "prevent_pe_source_revision_change"();
