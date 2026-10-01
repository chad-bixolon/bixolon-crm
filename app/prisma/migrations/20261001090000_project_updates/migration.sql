CREATE TABLE "ProjectUpdate" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER,
    "opportunityId" INTEGER,
    "body" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectUpdate_parent_check" CHECK ("projectId" IS NOT NULL OR "opportunityId" IS NOT NULL),
    CONSTRAINT "ProjectUpdate_body_check" CHECK (length(btrim("body")) > 0 AND length("body") <= 5000)
);

CREATE INDEX "ProjectUpdate_projectId_createdAt_idx" ON "ProjectUpdate"("projectId", "createdAt");
CREATE INDEX "ProjectUpdate_opportunityId_createdAt_idx" ON "ProjectUpdate"("opportunityId", "createdAt");
CREATE INDEX "ProjectUpdate_createdById_idx" ON "ProjectUpdate"("createdById");
CREATE INDEX "ProjectUpdate_updatedById_idx" ON "ProjectUpdate"("updatedById");

ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
