ALTER TABLE "OpportunityProduct" ADD COLUMN "skuId" INTEGER;
CREATE INDEX "OpportunityProduct_skuId_idx" ON "OpportunityProduct"("skuId");
ALTER TABLE "OpportunityProduct" ADD CONSTRAINT "OpportunityProduct_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
