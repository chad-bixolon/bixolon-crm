CREATE TYPE "DeploymentModule" AS ENUM (
  'OPPORTUNITIES', 'PROJECTS', 'SUPPORT_CASES', 'SUPPORT_INBOX', 'MARKETING',
  'TRADE_SHOWS', 'DEMOS', 'PRICE_EXCEPTIONS', 'PRODUCTS', 'SALES_PLANS', 'FORECASTING'
);

CREATE TABLE "DeploymentModuleVisibility" (
  "module" "DeploymentModule" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" INTEGER,
  CONSTRAINT "DeploymentModuleVisibility_pkey" PRIMARY KEY ("module")
);

CREATE INDEX "DeploymentModuleVisibility_updatedById_idx" ON "DeploymentModuleVisibility"("updatedById");

ALTER TABLE "DeploymentModuleVisibility" ADD CONSTRAINT "DeploymentModuleVisibility_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "DeploymentModuleVisibility" ("module", "enabled", "updatedAt") VALUES
  ('OPPORTUNITIES', true, CURRENT_TIMESTAMP),
  ('PROJECTS', true, CURRENT_TIMESTAMP),
  ('SUPPORT_CASES', true, CURRENT_TIMESTAMP),
  ('SUPPORT_INBOX', true, CURRENT_TIMESTAMP),
  ('MARKETING', true, CURRENT_TIMESTAMP),
  ('TRADE_SHOWS', true, CURRENT_TIMESTAMP),
  ('DEMOS', true, CURRENT_TIMESTAMP),
  ('PRICE_EXCEPTIONS', true, CURRENT_TIMESTAMP),
  ('PRODUCTS', true, CURRENT_TIMESTAMP),
  ('SALES_PLANS', true, CURRENT_TIMESTAMP),
  ('FORECASTING', true, CURRENT_TIMESTAMP);
