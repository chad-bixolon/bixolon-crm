import type { PrismaClient } from '@prisma/client';
import { documentWhere, type DocumentParentType } from './documents';
import { detailPage } from './detail-pagination';

export async function loadDocumentList(db: PrismaClient, parent: { type: DocumentParentType; id: number }, archived: boolean, rawPage?: string) {
  const where = documentWhere(parent, archived);
  const pagination = parent.type === 'account' ? detailPage(await db.document.count({ where }), rawPage) : null;
  const documents = await db.document.findMany({ where, select: {
    id: true, originalFileName: true, description: true, documentType: true, fileSize: true, createdAt: true, archivedAt: true,
    uploadedBy: { select: { firstName: true, lastName: true } }, archivedBy: { select: { firstName: true, lastName: true } },
  }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}) });
  return { documents, pagination };
}
