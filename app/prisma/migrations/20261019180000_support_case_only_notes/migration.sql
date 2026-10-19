-- A Support Case supplies parent context even without a linked CRM Account.
-- One ALTER keeps the constraint replacement atomic and preserves every row.
ALTER TABLE "Note" DROP CONSTRAINT "Note_parent_check",
ADD CONSTRAINT "Note_parent_check" CHECK (
  "accountId" IS NOT NULL OR "opportunityId" IS NOT NULL OR
  "projectId" IS NOT NULL OR "supportCaseId" IS NOT NULL
);
