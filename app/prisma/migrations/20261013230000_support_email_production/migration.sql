-- Forward-only port from the validated Support Email POC; no historical migrations changed.
-- AlterTable
ALTER TABLE "SupportCaseAttachment" ADD COLUMN     "sourceGmailAttachmentId" TEXT,
ADD COLUMN     "sourceGmailMessageId" TEXT,
ADD COLUMN     "sourceGmailPartId" TEXT,
ADD COLUMN     "sourceGmailThreadId" TEXT,
ADD COLUMN     "sourceMailbox" TEXT;

-- CreateTable
CREATE TABLE "SupportCaseEmail" (
    "id" SERIAL NOT NULL,
    "supportCaseId" INTEGER NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "messageDate" TIMESTAMP(3) NOT NULL,
    "linkedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportInboxDismissal" (
    "id" SERIAL NOT NULL,
    "mailbox" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "ignoredByUserId" INTEGER NOT NULL,
    "ignoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportInboxDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportGmailConnection" (
    "id" TEXT NOT NULL DEFAULT 'support',
    "mailbox" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "grantedScope" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "connectedByUserId" INTEGER NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportGmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportCaseEmail_gmailMessageId_key" ON "SupportCaseEmail"("gmailMessageId");

-- CreateIndex
CREATE INDEX "SupportCaseEmail_supportCaseId_messageDate_idx" ON "SupportCaseEmail"("supportCaseId", "messageDate");

-- CreateIndex
CREATE INDEX "SupportCaseEmail_gmailThreadId_idx" ON "SupportCaseEmail"("gmailThreadId");

-- CreateIndex
CREATE INDEX "SupportInboxDismissal_ignoredByUserId_idx" ON "SupportInboxDismissal"("ignoredByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportInboxDismissal_mailbox_gmailMessageId_key" ON "SupportInboxDismissal"("mailbox", "gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCaseAttachment_email_source_key" ON "SupportCaseAttachment"("supportCaseId", "sourceMailbox", "sourceGmailMessageId", "sourceGmailPartId");

-- AddForeignKey
ALTER TABLE "SupportCaseEmail" ADD CONSTRAINT "SupportCaseEmail_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCaseEmail" ADD CONSTRAINT "SupportCaseEmail_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportInboxDismissal" ADD CONSTRAINT "SupportInboxDismissal_ignoredByUserId_fkey" FOREIGN KEY ("ignoredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportGmailConnection" ADD CONSTRAINT "SupportGmailConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

