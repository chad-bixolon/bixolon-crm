-- CreateEnum
CREATE TYPE "DemoStatus" AS ENUM ('PENDING', 'APPROVED', 'SHIPPED');
CREATE TYPE "DemoUnitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DEPLOYED', 'RETURNED');

-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" SERIAL NOT NULL,
    "sourceRequestId" UUID,
    "demoNumber" TEXT,
    "status" "DemoStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "accountId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "opportunityId" INTEGER,
    "shippingAddress" TEXT,
    "shippingCarrier" TEXT,
    "carrierAccountNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "shippedById" INTEGER,
    "durationValue" INTEGER,
    "durationUnit" TEXT,
    "expectedReturnOverrideAt" TIMESTAMP(3),
    "expectedReturnOverrideById" INTEGER,
    "expectedReturnOverrideRecordedAt" TIMESTAMP(3),
    "expectedReturnOverrideReason" TEXT,
    "notes" TEXT,
    "approvalComments" TEXT,
    "sourceHeader" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoItem" (
    "id" SERIAL NOT NULL,
    "demoRequestId" INTEGER NOT NULL,
    "sourceLineKey" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceSku" TEXT NOT NULL,
    "productSkuId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "serialNumbers" JSONB NOT NULL,
    "trackingNumbers" JSONB NOT NULL,
    "inventoryLocations" JSONB NOT NULL,
    "sourceValues" JSONB NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoSourceRevision" (
    "id" SERIAL NOT NULL,
    "demoRequestId" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceRowNumbers" JSONB NOT NULL,
    "sourceRows" JSONB NOT NULL,
    "reviewedMappings" JSONB NOT NULL,
    "resolvedHeader" JSONB NOT NULL,
    "resolvedItems" JSONB NOT NULL,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoSourceRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoUnit" (
    "id" SERIAL NOT NULL,
    "demoItemId" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "serialNumber" TEXT,
    "status" "DemoUnitStatus" NOT NULL DEFAULT 'REQUESTED',
    "deployedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "inventoryLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemoUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoReturnEvent" (
    "id" SERIAL NOT NULL,
    "demoUnitId" INTEGER NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "trackingNumber" TEXT,
    "note" TEXT,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoReturnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoRequest_sourceRequestId_key" ON "DemoRequest"("sourceRequestId");

-- CreateIndex
CREATE INDEX "DemoRequest_demoNumber_idx" ON "DemoRequest"("demoNumber");

-- CreateIndex
CREATE INDEX "DemoRequest_accountId_status_idx" ON "DemoRequest"("accountId", "status");

CREATE INDEX "DemoRequest_projectId_requestedAt_idx" ON "DemoRequest"("projectId", "requestedAt");

CREATE INDEX "DemoRequest_opportunityId_requestedAt_idx" ON "DemoRequest"("opportunityId", "requestedAt");

-- CreateIndex
CREATE INDEX "DemoRequest_requestedById_status_idx" ON "DemoRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "DemoRequest_status_requestedAt_idx" ON "DemoRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "DemoItem_productSkuId_idx" ON "DemoItem"("productSkuId");

-- CreateIndex
CREATE INDEX "DemoItem_demoRequestId_retiredAt_idx" ON "DemoItem"("demoRequestId", "retiredAt");
CREATE UNIQUE INDEX "DemoUnit_demoItemId_ordinal_key" ON "DemoUnit"("demoItemId", "ordinal");
CREATE INDEX "DemoUnit_status_deployedAt_idx" ON "DemoUnit"("status", "deployedAt");
CREATE INDEX "DemoUnit_serialNumber_idx" ON "DemoUnit"("serialNumber");
CREATE INDEX "DemoReturnEvent_demoUnitId_createdAt_idx" ON "DemoReturnEvent"("demoUnitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DemoItem_demoRequestId_sourceLineKey_key" ON "DemoItem"("demoRequestId", "sourceLineKey");

-- CreateIndex
CREATE INDEX "DemoSourceRevision_demoRequestId_sourceTimestamp_idx" ON "DemoSourceRevision"("demoRequestId", "sourceTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DemoSourceRevision_demoRequestId_contentHash_key" ON "DemoSourceRevision"("demoRequestId", "contentHash");

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_expectedReturnOverrideById_fkey" FOREIGN KEY ("expectedReturnOverrideById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoItem" ADD CONSTRAINT "DemoItem_demoRequestId_fkey" FOREIGN KEY ("demoRequestId") REFERENCES "DemoRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoItem" ADD CONSTRAINT "DemoItem_productSkuId_fkey" FOREIGN KEY ("productSkuId") REFERENCES "ProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoUnit" ADD CONSTRAINT "DemoUnit_demoItemId_fkey" FOREIGN KEY ("demoItemId") REFERENCES "DemoItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoReturnEvent" ADD CONSTRAINT "DemoReturnEvent_demoUnitId_fkey" FOREIGN KEY ("demoUnitId") REFERENCES "DemoUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoReturnEvent" ADD CONSTRAINT "DemoReturnEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoSourceRevision" ADD CONSTRAINT "DemoSourceRevision_demoRequestId_fkey" FOREIGN KEY ("demoRequestId") REFERENCES "DemoRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoSourceRevision" ADD CONSTRAINT "DemoSourceRevision_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_demo_revision_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Demo source revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DemoSourceRevision_append_only"
BEFORE UPDATE OR DELETE ON "DemoSourceRevision"
FOR EACH ROW EXECUTE FUNCTION "prevent_demo_revision_change"();

CREATE FUNCTION "prevent_demo_return_event_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Demo return events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DemoReturnEvent_append_only"
BEFORE UPDATE OR DELETE ON "DemoReturnEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_demo_return_event_change"();

-- Keep business context compatible even when participating Accounts change later.
CREATE FUNCTION "validate_demo_context"() RETURNS trigger AS $$
BEGIN
    IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Project" p WHERE p.id = NEW."projectId"
        AND (p."primaryAccountId" = NEW."accountId" OR EXISTS (
            SELECT 1 FROM "ProjectAccount" pa WHERE pa."projectId" = p.id AND pa."accountId" = NEW."accountId"
        ))
    ) THEN RAISE EXCEPTION 'Demo Project must involve its Account'; END IF;
    IF NEW."opportunityId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "OpportunityAccount" oa WHERE oa."opportunityId" = NEW."opportunityId" AND oa."accountId" = NEW."accountId"
    ) THEN RAISE EXCEPTION 'Demo Opportunity must involve its Account'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DemoRequest_compatible_context"
BEFORE INSERT OR UPDATE OF "accountId", "projectId", "opportunityId" ON "DemoRequest"
FOR EACH ROW EXECUTE FUNCTION "validate_demo_context"();

CREATE FUNCTION "prevent_demo_context_orphan"() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'Project' THEN
        IF EXISTS (SELECT 1 FROM "DemoRequest" d WHERE d."projectId" = OLD.id
            AND d."accountId" = OLD."primaryAccountId"
            AND d."accountId" IS DISTINCT FROM NEW."primaryAccountId"
            AND NOT EXISTS (SELECT 1 FROM "ProjectAccount" pa WHERE pa."projectId" = OLD.id AND pa."accountId" = d."accountId"))
        THEN RAISE EXCEPTION 'Project Account change would orphan a Demo'; END IF;
        RETURN NEW;
    ELSIF TG_TABLE_NAME = 'ProjectAccount' THEN
        IF EXISTS (SELECT 1 FROM "DemoRequest" d WHERE d."projectId" = OLD."projectId" AND d."accountId" = OLD."accountId"
            AND NOT EXISTS (SELECT 1 FROM "Project" p WHERE p.id = OLD."projectId" AND p."primaryAccountId" = OLD."accountId"))
        THEN RAISE EXCEPTION 'Project participant change would orphan a Demo'; END IF;
        IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
        RETURN OLD;
    ELSE
        IF EXISTS (SELECT 1 FROM "DemoRequest" d WHERE d."opportunityId" = OLD."opportunityId" AND d."accountId" = OLD."accountId")
        THEN RAISE EXCEPTION 'Opportunity participant change would orphan a Demo'; END IF;
        IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_demo_primary_account_guard"
BEFORE UPDATE OF "primaryAccountId" ON "Project"
FOR EACH ROW EXECUTE FUNCTION "prevent_demo_context_orphan"();

CREATE TRIGGER "ProjectAccount_demo_guard"
BEFORE DELETE OR UPDATE OF "projectId", "accountId" ON "ProjectAccount"
FOR EACH ROW EXECUTE FUNCTION "prevent_demo_context_orphan"();

CREATE TRIGGER "OpportunityAccount_demo_guard"
BEFORE DELETE OR UPDATE OF "opportunityId", "accountId" ON "OpportunityAccount"
FOR EACH ROW EXECUTE FUNCTION "prevent_demo_context_orphan"();
