import { DocumentType, Prisma, type PrismaClient } from '@prisma/client';
import { can, opportunityScope, type Actor } from './authorization';
import { canEditProject, projectReadWhere } from './projects';
import type { DocumentStorage } from './document-storage';
import type { ValidatedDocumentFile } from './document-validation';

export type DocumentParentType = 'account' | 'project' | 'opportunity';
export const documentTypeLabels: Record<DocumentType, string> = {
  QUOTE: 'Quote', STATEMENT_OF_WORK: 'Statement of Work', CONTRACT: 'Contract', ADDENDUM: 'Addendum',
  PROPOSAL: 'Proposal', NDA: 'NDA', TECHNICAL_DOCUMENT: 'Technical Document', OTHER: 'Other',
};

export function parseDocumentParent(type: string | null, rawId: string | null) {
  const id = Number(rawId);
  if (!['account', 'project', 'opportunity'].includes(type ?? '') || !Number.isSafeInteger(id) || id < 1) throw new Error('Invalid document parent.');
  return { type: type as DocumentParentType, id };
}

export function parseDocumentMetadata(form: FormData) {
  const rawType = String(form.get('documentType') ?? '');
  if (!Object.values(DocumentType).includes(rawType as DocumentType)) throw new Error('Choose a valid document type.');
  const description = String(form.get('description') ?? '').trim();
  if (description.length > 2000) throw new Error('Description must be 2,000 characters or fewer.');
  return { documentType: rawType as DocumentType, description: description || null };
}

export function documentParentData(parent: { type: DocumentParentType; id: number }) {
  return parent.type === 'account' ? { accountId: parent.id } : parent.type === 'project' ? { projectId: parent.id } : { opportunityId: parent.id };
}

type ParentClient = Pick<PrismaClient, 'account' | 'project' | 'opportunity'>;
export async function assertDocumentParentAccess(client: ParentClient, actor: Actor, parent: { type: DocumentParentType; id: number }, operation: 'read' | 'write') {
  if (parent.type === 'account') {
    if (!can(actor, operation === 'read' ? 'accounts.read' : 'accounts.write')) throw new Error('Access denied');
    const account = await client.account.findUnique({ where: { id: parent.id }, select: { id: true, archivedAt: true, status: true } });
    if (!account || (operation === 'write' && (account.archivedAt || account.status === 'ARCHIVED'))) throw new Error(operation === 'read' ? 'Document parent not found.' : 'Documents cannot be changed on an archived record.');
    return;
  }
  if (parent.type === 'project') {
    const project = await client.project.findFirst({ where: { AND: [{ id: parent.id }, projectReadWhere(actor)] }, include: { primaryAccount: { select: { ownerId: true } } } });
    if (!project) throw new Error('Document parent not found.');
    if (operation === 'write' && (project.archivedAt || !canEditProject(actor, project))) throw new Error('Access denied');
    return;
  }
  if (!can(actor, operation === 'read' ? 'sales.read' : 'sales.write')) throw new Error('Access denied');
  const opportunity = await client.opportunity.findFirst({ where: { id: parent.id, ...opportunityScope(actor) }, select: { id: true, archivedAt: true } });
  if (!opportunity) throw new Error('Document parent not found.');
  if (operation === 'write' && opportunity.archivedAt) throw new Error('Documents cannot be changed on an archived record.');
}

export async function uploadDocument(
  client: PrismaClient,
  storage: DocumentStorage,
  actor: Actor,
  parent: { type: DocumentParentType; id: number },
  file: ValidatedDocumentFile,
  metadata: { documentType: DocumentType; description: string | null },
) {
  await assertDocumentParentAccess(client, actor, parent, 'write');
  const storageKey = storage.createKey();
  await storage.uploadDocumentObject({ storageKey, body: file.body, mimeType: file.mimeType });
  try {
    return await client.document.create({ data: {
      ...documentParentData(parent), originalFileName: file.originalFileName, storageKey, mimeType: file.mimeType,
      fileSize: file.fileSize, documentType: metadata.documentType, description: metadata.description, uploadedByUserId: actor.id,
    } });
  } catch (error) {
    try { await storage.deleteObjectForFailedUpload(storageKey); } catch (cleanupError) {
      console.error('Document storage compensation failed.', { operation: 'upload-compensation', parentType: parent.type, parentId: parent.id, errorClass: cleanupError instanceof Error ? cleanupError.name : 'UnknownError' });
    }
    throw error;
  }
}

const documentParentSelect = { accountId: true, projectId: true, opportunityId: true } as const;
export function parentFromDocument(document: { accountId: number | null; projectId: number | null; opportunityId: number | null }) {
  if (document.accountId) return { type: 'account' as const, id: document.accountId };
  if (document.projectId) return { type: 'project' as const, id: document.projectId };
  if (document.opportunityId) return { type: 'opportunity' as const, id: document.opportunityId };
  throw new Error('Document has no valid parent.');
}

export async function archiveDocument(client: PrismaClient, actor: Actor, id: number) {
  const document = await client.document.findUnique({ where: { id }, select: { ...documentParentSelect, archivedAt: true } });
  if (!document) throw new Error('Document not found.');
  await assertDocumentParentAccess(client, actor, parentFromDocument(document), 'write');
  if (document.archivedAt) throw new Error('Document is already archived.');
  return client.document.update({ where: { id }, data: { archivedAt: new Date(), archivedByUserId: actor.id } });
}

export async function restoreDocument(client: PrismaClient, actor: Actor, id: number) {
  const document = await client.document.findUnique({ where: { id }, select: { ...documentParentSelect, archivedAt: true } });
  if (!document) throw new Error('Document not found.');
  await assertDocumentParentAccess(client, actor, parentFromDocument(document), 'write');
  if (!document.archivedAt) throw new Error('Document is already active.');
  return client.document.update({ where: { id }, data: { archivedAt: null, archivedByUserId: null } });
}

export async function createDocumentDownloadUrl(client: PrismaClient, storage: DocumentStorage, actor: Actor, id: number, archivedView = false) {
  const document = await client.document.findUnique({ where: { id }, select: { ...documentParentSelect, archivedAt: true, storageKey: true, originalFileName: true, mimeType: true } });
  if (!document) throw new Error('Document not found.');
  await assertDocumentParentAccess(client, actor, parentFromDocument(document), 'read');
  if (document.archivedAt && !archivedView) throw new Error('Document not found.');
  return storage.createSignedDocumentUrl({ storageKey: document.storageKey, fileName: document.originalFileName, mimeType: document.mimeType });
}

export function documentWhere(parent: { type: DocumentParentType; id: number }, archived: boolean): Prisma.DocumentWhereInput {
  return { ...documentParentData(parent), archivedAt: archived ? { not: null } : null };
}
