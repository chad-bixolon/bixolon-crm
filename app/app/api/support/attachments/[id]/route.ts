import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { documentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import { removeSupportAttachment, SupportAttachmentMetadataError } from '@/lib/support-attachments';

export const runtime = 'nodejs';
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  try {
    await removeSupportAttachment(prisma, documentStorage, await currentUser(), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Support attachment removal failed.', { id, error });
    if (error instanceof SupportAttachmentMetadataError) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ error: 'Attachment could not be removed.' }, { status: 400 });
  }
}
