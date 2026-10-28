import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { documentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import { assertSupportAttachmentAccess, uploadSupportAttachment } from '@/lib/support-attachments';
import { MAX_SUPPORT_ATTACHMENT_BYTES, validateSupportAttachment } from '@/lib/support-attachment-validation';
import { captureRouteError } from '../../../../../../lib/request-observability';

export const runtime = 'nodejs';
const known = new Set(['File is too large. Maximum size is 25 MB.', 'File type is not supported.', 'The selected file is empty.', 'Choose a file with a valid name.', 'File is too large or incomplete.', 'Attachments cannot be changed on Closed or Archived cases.']);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caseId = Number((await params).id);
  if (!Number.isSafeInteger(caseId) || caseId < 1) return NextResponse.json({ error: 'Support Case not found.' }, { status: 404 });
  let actor;
  try {
    actor = await currentUser();
    await assertSupportAttachmentAccess(prisma, actor, caseId, true);
  } catch (error) { const incident = captureRouteError(request, error, 'support-attachment.authorize', { entityType: 'SupportCase', entityId: caseId }); return NextResponse.json({ error: incident ?? 'You do not have permission to add attachments.' }, { status: incident ? 500 : 403 }); }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_SUPPORT_ATTACHMENT_BYTES + 1024 * 1024) return NextResponse.json({ error: 'File is too large. Maximum size is 25 MB.' }, { status: 413 });
  try {
    const selected = (await request.formData()).get('file');
    if (!(selected instanceof File)) throw new Error('Choose a file with a valid name.');
    const file = await validateSupportAttachment(selected);
    const attachment = await uploadSupportAttachment(prisma, documentStorage, actor, caseId, file);
    return NextResponse.json({ id: attachment.id }, { status: 201 });
  } catch (error) {
    const incident = known.has(error instanceof Error ? error.message : '') ? undefined : captureRouteError(request, error, 'support-attachment.upload', { entityType: 'SupportCase', entityId: caseId, userId: actor.id });
    const message = error instanceof Error && known.has(error.message) ? error.message : 'Upload failed. Please try again.';
    return NextResponse.json({ error: incident ?? message }, { status: incident ? 500 : message.startsWith('File is too large') ? 413 : 400 });
  }
}
