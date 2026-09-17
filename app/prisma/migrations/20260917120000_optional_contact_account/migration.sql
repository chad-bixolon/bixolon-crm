-- Allow Contacts to exist before they are assigned to an Account.
ALTER TABLE "Contact" ALTER COLUMN "accountId" DROP NOT NULL;

-- A primary Contact still belongs to exactly one Account.
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_primary_account_check"
  CHECK (NOT "isPrimary" OR "accountId" IS NOT NULL);
