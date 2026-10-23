CREATE TABLE "DeploymentBranding" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" VARCHAR(200) NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "logoStorageKey" VARCHAR(500),
    "logoMimeType" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeploymentBranding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeploymentBranding_singleton" CHECK ("id" = 1),
    CONSTRAINT "DeploymentBranding_logo_pair" CHECK (("logoStorageKey" IS NULL) = ("logoMimeType" IS NULL))
);

CREATE TABLE "TrustedSignInDomain" (
    "domain" VARCHAR(253) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrustedSignInDomain_pkey" PRIMARY KEY ("domain"),
    CONSTRAINT "TrustedSignInDomain_lowercase" CHECK ("domain" = lower("domain"))
);
