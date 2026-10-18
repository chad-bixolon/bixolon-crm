-- Add configuration only. Never rewrite transaction or snapshot currencies.
ALTER TABLE "Currency" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
INSERT INTO "Currency" ("code", "name", "active", "isDefault", "updatedAt")
VALUES ('USD', 'US Dollar', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "active" = true, "isDefault" = true;
CREATE UNIQUE INDEX "Currency_one_default" ON "Currency" ("isDefault") WHERE "isDefault";
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_default_active" CHECK (NOT "isDefault" OR "active");
