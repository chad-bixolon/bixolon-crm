-- Outbound email logs are Activities; Gmail keeps the email and attachments.
ALTER TABLE "Activity"
  ADD COLUMN "emailRecipientName" VARCHAR(200),
  ADD COLUMN "emailRecipientEmail" VARCHAR(254);

-- A Support Case is sufficient context even without a linked CRM Account.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_parent_check";
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_parent_check"
  CHECK ("accountId" IS NOT NULL OR "opportunityId" IS NOT NULL OR "supportCaseId" IS NOT NULL);
