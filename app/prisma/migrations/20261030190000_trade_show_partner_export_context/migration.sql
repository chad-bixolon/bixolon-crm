BEGIN;
-- Retain original 16-column disclosures and allow the expanded 20-column lead context.
-- Existing snapshots and handoff history remain unchanged.
ALTER TABLE "TradeShowPartnerHandoffLead" DROP CONSTRAINT "TradeShowPartnerHandoffLead_snapshot_check";
ALTER TABLE "TradeShowPartnerHandoffLead" ADD CONSTRAINT "TradeShowPartnerHandoffLead_snapshot_check"
  CHECK ("assignmentVersion" > 0 AND jsonb_typeof("exportRow") = 'array'
    AND jsonb_array_length("exportRow") IN (16, 20));
COMMIT;
