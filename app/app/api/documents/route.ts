import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { documentStorage } from '@/lib/document-storage';
import { assertDocumentParentAccess, parseDocumentMetadata, parseDocumentParent, uploadDocument } from '@/lib/documents';
import { MAX_DOCUMENT_BYTES, validateDocumentFile } from '@/lib/document-validation';
import { captureRouteError } from '../../../lib/request-observability';

export const runtime = 'nodejs';

function responseError(error: unknown, status = 400) {
  const message = error instanceof Error && [
    'Access denied', 'Invalid document parent.', 'Document parent not found.', 'Documents cannot be changed on an archived record.',
    'Choose a valid document type.', 'Description must be 2,000 characters or fewer.', 'Choose a file with a valid name.',
    'The selected file is empty.', 'Documents must be 25 MB or smaller.', 'Unsupported file type. Upload a PDF or Microsoft Office document.',
    'The file extension and content type do not match.', 'The file contents do not match the selected file type.',
  ].includes(error.message) ? error.message : 'The document could not be uploaded. Please try again.';
  return NextResponse.json({ error: message }, { status: message === 'Access denied' ? 403 : status });
}

export async function POST(request: Request) {
  let parent;
  let actor;
  try {
    const url = new URL(request.url);
    parent = parseDocumentParent(url.searchParams.get('parentType'), url.searchParams.get('parentId'));
    actor = await currentUser();
    // Parent and write authorization are checked before parsing the multipart body.
    await assertDocumentParentAccess(prisma, actor, parent, 'write');
  } catch (error) { const incident = captureRouteError(request, error, 'document.authorize'); return incident ? NextResponse.json({ error: incident }, { status: 500 }) : responseError(error); }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENT_BYTES + 1024 * 1024) return responseError(new Error('Documents must be 25 MB or smaller.'), 413);
  try {
    const form = await request.formData();
    const selected = form.get('file');
    if (!(selected instanceof File)) throw new Error('Choose a file with a valid name.');
    const [file, metadata] = await Promise.all([validateDocumentFile(selected), Promise.resolve(parseDocumentMetadata(form))]);
    const document = await uploadDocument(prisma, documentStorage, actor, parent, file, metadata);
    return NextResponse.json({ id: document.id }, { status: 201 });
  } catch (error) {
    const incident = captureRouteError(request, error, 'document.upload', { entityType: parent.type, entityId: parent.id, userId: actor.id });
    return incident ? NextResponse.json({ error: incident }, { status: 500 }) : responseError(error, error instanceof Error && error.message.includes('25 MB') ? 413 : 400);
  }
}
