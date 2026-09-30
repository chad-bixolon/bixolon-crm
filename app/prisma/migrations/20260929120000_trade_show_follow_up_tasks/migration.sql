ALTER TABLE "Task"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "tradeShowLeadId" INTEGER,
  ADD COLUMN "contactId" INTEGER,
  ADD COLUMN "originalAssigneeId" INTEGER;

ALTER TABLE "Task" ADD CONSTRAINT "Task_tradeShowLeadId_fkey" FOREIGN KEY ("tradeShowLeadId") REFERENCES "TradeShowLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_originalAssigneeId_fkey" FOREIGN KEY ("originalAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Task_tradeShowLeadId_createdAt_idx" ON "Task"("tradeShowLeadId", "createdAt");
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");
CREATE UNIQUE INDEX "Task_active_trade_show_follow_up_key" ON "Task"("tradeShowLeadId")
  WHERE "source" = 'TRADE_SHOW_LEAD_FOLLOW_UP' AND "archivedAt" IS NULL AND "status" IN ('OPEN', 'IN_PROGRESS');

CREATE TABLE "TaskAssignmentEvent" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "taskId" INTEGER NOT NULL,
  "fromUserId" INTEGER,
  "toUserId" INTEGER,
  "actorId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAssignmentEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TaskAssignmentEvent_taskId_createdAt_idx" ON "TaskAssignmentEvent"("taskId", "createdAt");
