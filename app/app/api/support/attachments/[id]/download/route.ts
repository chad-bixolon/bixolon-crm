import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { documentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import { supportAttachmentDownloadUrl } from '@/lib/support-attachments';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  try {
    const url = await supportAttachmentDownloadUrl(prisma, documentStorage, await currentUser(), id);
    const response = NextResponse.redirect(url, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Support attachment download failed.', { id, error });
    return NextResponse.json({ error: 'Attachment not available.' }, { status: 404 });
  }
}
