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
    try { await storage.deleteDocumentObject(storageKey); }
    catch (cleanupError) { console.error('Support attachment cleanup failed.', { caseId, error: cleanupError }); }
    throw error;
  }
}

export class SupportAttachmentMetadataError extends Error {
  constructor() { super('The file was deleted, but its case record could not be updated. Contact an administrator.'); }
}

export async function removeSupportAttachment(db: PrismaClient, storage: DocumentStorage, actor: Actor, id: number) {
  const attachment = await db.supportCaseAttachment.findUnique({ where: { id }, select: { supportCaseId: true, deletedAt: true, storageKey: true } });
  if (!attachment) throw new Error('Attachment not found.');
  await assertSupportAttachmentAccess(db, actor, attachment.supportCaseId, true);
  if (attachment.deletedAt) return;
  try { await storage.deleteDocumentObject(attachment.storageKey); }
  catch (error) {
    console.error('Support attachment object deletion failed.', { id, caseId: attachment.supportCaseId, storageKey: attachment.storageKey, error });
    throw new Error('Attachment could not be removed. Please try again.');
  }
  // A single conditional update records actor and time atomically. A retry can reconcile
  // an object deleted by a prior request whose database update failed.
  try {
    const result = await db.supportCaseAttachment.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedByUserId: actor.id } });
    if (!result.count) {
      const current = await db.supportCaseAttachment.findUnique({ where: { id }, select: { deletedAt: true } });
      if (!current?.deletedAt) throw new Error('Attachment metadata disappeared after object deletion.');
    }
  } catch (error) {
    console.error('Support attachment object deleted but metadata update failed; retry removal to reconcile.', { id, caseId: attachment.supportCaseId, storageKey: attachment.storageKey, actorId: actor.id, error });
    throw new SupportAttachmentMetadataError();
  }
}

export async function supportAttachmentDownloadUrl(db: PrismaClient, storage: DocumentStorage, actor: Actor, id: number) {
  const attachment = await db.supportCaseAttachment.findUnique({ where: { id }, select: { supportCaseId: true, deletedAt: true, storageKey: true, originalFileName: true, contentType: true } });
  if (!attachment || attachment.deletedAt) throw new Error('Attachment not found.');
  await assertSupportAttachmentAccess(db, actor, attachment.supportCaseId);
  return storage.createSignedDocumentUrl({ storageKey: attachment.storageKey, fileName: attachment.originalFileName, mimeType: attachment.contentType });
}
