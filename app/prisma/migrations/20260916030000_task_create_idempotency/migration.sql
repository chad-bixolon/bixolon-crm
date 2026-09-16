ALTER TABLE "Task" ADD COLUMN "createKey" UUID;
CREATE UNIQUE INDEX "Task_createKey_key" ON "Task"("createKey");
