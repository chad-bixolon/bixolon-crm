CREATE TABLE "TerminologyLabel" (
    "key" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "changedById" INTEGER,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TerminologyLabel_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "changedById" INTEGER,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
