ALTER TABLE "Account"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "stateProvince" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT;

ALTER TABLE "Contact"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "stateProvince" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT;
