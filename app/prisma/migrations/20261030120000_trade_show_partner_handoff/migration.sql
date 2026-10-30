BEGIN;
-- CreateEnum
CREATE TYPE "PartnerHandoffStatus" AS ENUM ('AWAITING_PARTNER_HANDOFF', 'SENT_TO_PARTNER');

-- AlterTable
ALTER TABLE "TradeShowLead" ADD COLUMN     "partnerAssignmentVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "partnerAwaitingAt" TIMESTAMP(3),
ADD COLUMN     "partnerHandoffNotes" TEXT,
ADD COLUMN     "partnerHandoffStatus" "PartnerHandoffStatus",
ADD COLUMN     "partnerSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TradeShowPartnerHandoff" (
    "id" SERIAL NOT NULL,
    "tradeShowId" INTEGER NOT NULL,
    "partnerAccountId" INTEGER NOT NULL,
    "partnerName" TEXT NOT NULL,
    "tradeShowName" TEXT NOT NULL,
    "handedOffAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedById" INTEGER NOT NULL,
    "leadCount" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "PartnerHandoffStatus" NOT NULL DEFAULT 'SENT_TO_PARTNER',
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "TradeShowPartnerHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeShowPartnerHandoffLead" (
    "batchId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "assignmentVersion" INTEGER NOT NULL,
    "exportRow" JSONB NOT NULL,

    CONSTRAINT "TradeShowPartnerHandoffLead_pkey" PRIMARY KEY ("batchId","leadId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeShowPartnerHandoff_taskId_key" ON "TradeShowPartnerHandoff"("taskId");

-- CreateIndex
CREATE INDEX "TradeShowPartnerHandoff_tradeShowId_partnerAccountId_handed_idx" ON "TradeShowPartnerHandoff"("tradeShowId", "partnerAccountId", "handedOffAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeShowPartnerHandoffLead_leadId_assignmentVersion_key" ON "TradeShowPartnerHandoffLead"("leadId", "assignmentVersion");

-- CreateIndex
CREATE INDEX "TradeShowLead_tradeShowId_routedPartnerAccountId_partnerHan_idx" ON "TradeShowLead"("tradeShowId", "routedPartnerAccountId", "partnerHandoffStatus");

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoff" ADD CONSTRAINT "TradeShowPartnerHandoff_tradeShowId_fkey" FOREIGN KEY ("tradeShowId") REFERENCES "TradeShow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoff" ADD CONSTRAINT "TradeShowPartnerHandoff_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoff" ADD CONSTRAINT "TradeShowPartnerHandoff_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoff" ADD CONSTRAINT "TradeShowPartnerHandoff_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoffLead" ADD CONSTRAINT "TradeShowPartnerHandoffLead_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TradeShowPartnerHandoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeShowPartnerHandoffLead" ADD CONSTRAINT "TradeShowPartnerHandoffLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "TradeShowLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No evidence of external delivery is inferred from a populated partner field.
UPDATE "TradeShowLead" l SET "partnerHandoffStatus" = 'AWAITING_PARTNER_HANDOFF',
  "partnerAssignmentVersion" = 1, "partnerAwaitingAt" = CURRENT_TIMESTAMP,
  "updatedAt" = GREATEST(CURRENT_TIMESTAMP, l."updatedAt" + INTERVAL '1 millisecond')
FROM "TradeShow" s WHERE s.id = l."tradeShowId" AND s."archivedAt" IS NULL
  AND l.routing = 'REFERRED_TO_PARTNER' AND l."routedPartnerAccountId" IS NOT NULL
  AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND l."convertedOpportunityId" IS NULL;

ALTER TABLE "TradeShowLead" ADD CONSTRAINT "TradeShowLead_partner_state_check" CHECK (
  "partnerAssignmentVersion" >= 0 AND (
    ("partnerHandoffStatus" IS NULL AND "partnerAwaitingAt" IS NULL AND "partnerSentAt" IS NULL) OR
    ("partnerHandoffStatus" IS NOT NULL AND routing = 'REFERRED_TO_PARTNER' AND "routedPartnerAccountId" IS NOT NULL AND "partnerAssignmentVersion" > 0
      AND "partnerAwaitingAt" IS NOT NULL AND
      (("partnerHandoffStatus" = 'AWAITING_PARTNER_HANDOFF' AND "partnerSentAt" IS NULL) OR
       ("partnerHandoffStatus" = 'SENT_TO_PARTNER' AND "partnerSentAt" IS NOT NULL)))
  ));
ALTER TABLE "TradeShowPartnerHandoff" ADD CONSTRAINT "TradeShowPartnerHandoff_sent_check"
  CHECK (status = 'SENT_TO_PARTNER' AND "leadCount" > 0);
ALTER TABLE "TradeShowPartnerHandoffLead" ADD CONSTRAINT "TradeShowPartnerHandoffLead_snapshot_check"
  CHECK ("assignmentVersion" > 0 AND jsonb_typeof("exportRow") = 'array' AND jsonb_array_length("exportRow") = 16);
CREATE TRIGGER partner_handoff_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "TradeShowPartnerHandoff"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_maintenance_mutation();
CREATE TRIGGER partner_handoff_lead_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "TradeShowPartnerHandoffLead"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_maintenance_mutation();

COMMIT;
