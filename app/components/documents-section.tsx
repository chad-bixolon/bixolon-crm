import Link from 'next/link';
import { DocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Actor } from '@/lib/authorization';
import { assertDocumentParentAccess, documentTypeLabels, documentWhere, type DocumentParentType } from '@/lib/documents';
import { DocumentArchive, DocumentFeedback, DocumentUpload } from './document-controls';

type Props = { parentType: DocumentParentType; parentId: number; actor: Actor; view?: string; basePath: string };
const types = Object.values(DocumentType).map(value => ({ value, label: documentTypeLabels[value] }));

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function viewHref(basePath: string, archived: boolean) {
  const [path, query = ''] = basePath.split('?');
  const params = new URLSearchParams(query);
  if (archived) params.set('documentsView', 'archived'); else params.delete('documentsView');
  return `${path}${params.size ? `?${params}` : ''}#documents`;
}

export async function DocumentsSection({ parentType, parentId, actor, view, basePath }: Props) {
  const parent = { type: parentType, id: parentId };
  await assertDocumentParentAccess(prisma, actor, parent, 'read');
  let canWrite = true;
  try { await assertDocumentParentAccess(prisma, actor, parent, 'write'); } catch { canWrite = false; }
  const archived = view === 'archived';
  const documents = await prisma.document.findMany({
    where: documentWhere(parent, archived),
    include: { uploadedBy: { select: { firstName: true, lastName: true } }, archivedBy: { select: { firstName: true, lastName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return <section id="documents" className="panel p-6">
    <DocumentFeedback/>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Documents</h2><div className="mt-2 flex gap-3 text-sm"><Link className={!archived ? 'font-semibold text-orange-800' : 'text-slate-600 underline'} href={viewHref(basePath, false)}>Active</Link><Link className={archived ? 'font-semibold text-orange-800' : 'text-slate-600 underline'} href={viewHref(basePath, true)}>Archived</Link></div></div>{canWrite && !archived && <DocumentUpload parent={parent} types={types}/>}</div>
    {documents.length ? <div className="divide-y border-y border-slate-200">
      <div className={`hidden gap-3 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500 md:grid ${archived ? 'md:grid-cols-[minmax(0,2fr)_1.2fr_1.2fr_1fr]' : 'md:grid-cols-[minmax(0,2fr)_1.2fr_1.1fr_.8fr_auto]'}`}><span>Name</span><span>Type</span><span>{archived ? 'Archived By' : 'Uploaded By'}</span><span>{archived ? 'Archived' : 'Uploaded / Size'}</span>{!archived && <span>Actions</span>}</div>
      {documents.map(document => <div key={document.id} className={`grid gap-2 px-3 py-3 text-sm ${archived ? 'md:grid-cols-[minmax(0,2fr)_1.2fr_1.2fr_1fr]' : 'md:grid-cols-[minmax(0,2fr)_1.2fr_1.1fr_.8fr_auto]'} md:items-center md:gap-3`}>
        <div className="min-w-0 break-words font-medium">{document.originalFileName}{document.description && <p className="mt-1 break-words text-xs font-normal text-slate-500">{document.description}</p>}</div>
        <div><span className="md:hidden label">Type: </span>{documentTypeLabels[document.documentType]}</div>
        <div><span className="md:hidden label">{archived ? 'Archived By' : 'Uploaded By'}: </span>{archived ? (document.archivedBy ? `${document.archivedBy.firstName} ${document.archivedBy.lastName}` : '—') : `${document.uploadedBy.firstName} ${document.uploadedBy.lastName}`}</div>
        <div className="text-slate-600"><span className="md:hidden label">{archived ? 'Archived' : 'Uploaded'}: </span>{(archived ? document.archivedAt : document.createdAt)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{!archived && <> · {formatSize(document.fileSize)}</>}</div>
        {!archived && <div className="flex gap-3 whitespace-nowrap"><a className="text-orange-800 underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">Open</a>{canWrite && <DocumentArchive id={document.id}/>}</div>}
        {archived && <div className="md:col-span-4"><a className="text-orange-800 underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">Open retained document</a></div>}
      </div>)}
    </div> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{archived ? 'No documents have been archived.' : 'No documents have been uploaded.'}</p>}
  </section>;
}
