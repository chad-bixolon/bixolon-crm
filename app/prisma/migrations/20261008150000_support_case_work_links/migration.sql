ALTER TABLE "Activity" ADD COLUMN "supportCaseId" INTEGER;
ALTER TABLE "Task" ADD COLUMN "supportCaseId" INTEGER;
ALTER TABLE "Note" ADD COLUMN "supportCaseId" INTEGER;

CREATE INDEX "Activity_supportCaseId_activityDate_idx" ON "Activity"("supportCaseId", "activityDate");
CREATE INDEX "Task_supportCaseId_dueDate_idx" ON "Task"("supportCaseId", "dueDate");
CREATE INDEX "Note_supportCaseId_createdAt_idx" ON "Note"("supportCaseId", "createdAt");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
