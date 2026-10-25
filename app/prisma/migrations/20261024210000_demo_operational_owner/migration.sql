ALTER TABLE "DemoRequest" ADD COLUMN "operationalOwnerId" INTEGER;
CREATE INDEX "DemoRequest_operationalOwnerId_status_idx" ON "DemoRequest"("operationalOwnerId", "status");
ALTER TABLE "DemoRequest" ADD CONSTRAINT "DemoRequest_operationalOwnerId_fkey" FOREIGN KEY ("operationalOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
