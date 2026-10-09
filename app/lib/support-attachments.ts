import type { PrismaClient } from '@prisma/client';
import { assertPermission, type Actor } from './authorization';
import { supportCaseReadWhere } from './support-cases';
import type { DocumentStorage } from './document-storage';
import type { ValidatedSupportAttachment } from './support-attachment-validation';

export async function assertSupportAttachmentAccess(db: PrismaClient, actor: Actor, caseId: number, write = false) {
  if (write) assertPermission(actor, 'support-cases.write');
  const row = await db.supportCase.findFirst({ where: { AND: [{ id: caseId }, supportCaseReadWhere(actor, true)] }, select: { id: true, archivedAt: true, status: true } });
  if (!row) throw new Error('Support Case not found.');
  if (write && (row.archivedAt || row.status === 'CLOSED')) throw new Error('Attachments cannot be changed on Closed or Archived cases.');
  return row;
}

export async function uploadSupportAttachment(db: PrismaClient, storage: DocumentStorage, actor: Actor, caseId: number, file: ValidatedSupportAttachment) {
  await assertSupportAttachmentAccess(db, actor, caseId, true);
  const storageKey = storage.createSupportKey();
  await storage.uploadDocumentObject({ storageKey, body: file.body, mimeType: file.mimeType });
  try {
    return await db.supportCaseAttachment.create({ data: {
      supportCaseId: caseId, originalFileName: file.originalFileName, storageKey,
      contentType: file.mimeType, fileSizeBytes: file.fileSize, uploadedByUserId: actor.id,
    } });
  } catch (error) {
    try { await storage.deleteObjectForFailedUpload(storageKey); }
    catch (cleanupError) { console.error('Support attachment cleanup failed.', { caseId, error: cleanupError }); }
    throw error;
  }
}

export async function removeSupportAttachment(db: PrismaClient, actor: Actor, id: number) {
  const attachment = await db.supportCaseAttachment.findUnique({ where: { id }, select: { supportCaseId: true, deletedAt: true } });
  if (!attachment) throw new Error('Attachment not found.');
  await assertSupportAttachmentAccess(db, actor, attachment.supportCaseId, true);
  if (attachment.deletedAt) throw new Error('Attachment not found.');
  const result = await db.supportCaseAttachment.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedByUserId: actor.id } });
  if (!result.count) throw new Error('Attachment not found.');
}

export async function supportAttachmentDownloadUrl(db: PrismaClient, storage: DocumentStorage, actor: Actor, id: number) {
  const attachment = await db.supportCaseAttachment.findUnique({ where: { id }, select: { supportCaseId: true, deletedAt: true, storageKey: true, originalFileName: true, contentType: true } });
  if (!attachment || attachment.deletedAt) throw new Error('Attachment not found.');
  await assertSupportAttachmentAccess(db, actor, attachment.supportCaseId);
  return storage.createSignedDocumentUrl({ storageKey: attachment.storageKey, fileName: attachment.originalFileName, mimeType: attachment.contentType });
}
