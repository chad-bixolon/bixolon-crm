import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { createDocumentDownloadUrl } from '@/lib/documents';
import { documentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  try {
    const actor = await currentUser();
    const url = await createDocumentDownloadUrl(prisma, documentStorage, actor, id, new URL(request.url).searchParams.get('view') === 'archived');
    const response = NextResponse.redirect(url, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const denied = error instanceof Error && error.message === 'Access denied';
    return NextResponse.json({ error: denied ? 'Access denied' : 'The document is not available.' }, { status: denied ? 403 : 404 });
  }
}
