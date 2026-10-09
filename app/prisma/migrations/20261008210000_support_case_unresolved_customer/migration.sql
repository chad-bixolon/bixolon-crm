ALTER TABLE "SupportCase" ADD COLUMN "customerNameText" TEXT;
ALTER TABLE "SupportCase" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_customer_required_check" CHECK (NULLIF(BTRIM("customerNameText"), '') IS NOT NULL OR "accountId" IS NOT NULL);
