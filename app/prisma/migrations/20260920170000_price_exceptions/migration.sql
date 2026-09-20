CREATE TYPE "PriceExceptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "PriceExceptionSourceType" AS ENUM ('LEGACY_WORKBOOK', 'EXTERNAL_EXPORT');

CREATE TABLE "PriceException" (
  "id" SERIAL NOT NULL,
  "peCode" TEXT,
  "predecessorPeCode" TEXT,
  "status" "PriceExceptionStatus" NOT NULL,
  "sourceType" "PriceExceptionSourceType" NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "distributorAccountId" INTEGER,
  "varAccountId" INTEGER,
  "endUserAccountId" INTEGER,
  "distributorSourceName" TEXT,
  "varSourceName" TEXT,
  "endUserSourceName" TEXT,
  "distributorSalesRep" TEXT,
  "effectiveDate" DATE,
  "expirationDate" DATE,
  "sourceDescription" TEXT,
  "competitor" TEXT,
  "sourceFileName" TEXT,
  "sourceSheet" TEXT,
  "sourceMetadata" JSONB,
  "archivedAt" TIMESTAMP(3),
  "createdById" INTEGER,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceExceptionLine" (
  "id" SERIAL NOT NULL,
  "priceExceptionId" INTEGER NOT NULL,
  "sourceLineKey" TEXT NOT NULL,
  "productSkuId" INTEGER,
  "sourceSku" TEXT,
  "approvedUnitPrice" DECIMAL(12,2),
  "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "sourceQuantity" DECIMAL(14,3),
  "sourceQuantityRaw" TEXT,
  "sourceUnit" TEXT,
  "comments" TEXT,
  "competitor" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "sourceMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PriceExceptionLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceException_sourceType_sourceKey_key" ON "PriceException"("sourceType", "sourceKey");
CREATE INDEX "PriceException_peCode_idx" ON "PriceException"("peCode");
CREATE INDEX "PriceException_status_expirationDate_idx" ON "PriceException"("status", "expirationDate");
CREATE INDEX "PriceException_distributorAccountId_idx" ON "PriceException"("distributorAccountId");
CREATE INDEX "PriceException_varAccountId_idx" ON "PriceException"("varAccountId");
CREATE INDEX "PriceException_endUserAccountId_idx" ON "PriceException"("endUserAccountId");
CREATE INDEX "PriceException_archivedAt_idx" ON "PriceException"("archivedAt");
CREATE UNIQUE INDEX "PriceExceptionLine_priceExceptionId_sourceLineKey_key" ON "PriceExceptionLine"("priceExceptionId", "sourceLineKey");
CREATE INDEX "PriceExceptionLine_productSkuId_priceExceptionId_idx" ON "PriceExceptionLine"("productSkuId", "priceExceptionId");
CREATE INDEX "PriceExceptionLine_priceExceptionId_sortOrder_idx" ON "PriceExceptionLine"("priceExceptionId", "sortOrder");

ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_distributorAccountId_fkey" FOREIGN KEY ("distributorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_varAccountId_fkey" FOREIGN KEY ("varAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_endUserAccountId_fkey" FOREIGN KEY ("endUserAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceException" ADD CONSTRAINT "PriceException_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionLine" ADD CONSTRAINT "PriceExceptionLine_priceExceptionId_fkey" FOREIGN KEY ("priceExceptionId") REFERENCES "PriceException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceExceptionLine" ADD CONSTRAINT "PriceExceptionLine_productSkuId_fkey" FOREIGN KEY ("productSkuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
