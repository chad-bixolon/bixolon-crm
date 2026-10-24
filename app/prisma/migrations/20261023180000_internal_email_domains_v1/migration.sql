CREATE TABLE "InternalEmailDomain" (
  "domain" VARCHAR(253) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" INTEGER,
  CONSTRAINT "InternalEmailDomain_pkey" PRIMARY KEY ("domain"),
  CONSTRAINT "InternalEmailDomain_lowercase" CHECK ("domain" = lower("domain"))
);

CREATE INDEX "InternalEmailDomain_updatedById_idx" ON "InternalEmailDomain"("updatedById");

ALTER TABLE "InternalEmailDomain" ADD CONSTRAINT "InternalEmailDomain_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
