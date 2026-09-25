import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { restoreDocument } from '@/lib/documents';
import { prisma } from '@/lib/prisma';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  try {
    await restoreDocument(prisma, await currentUser(), id);
    return NextResponse.json({ restored: true });
  } catch (error) {
    const denied = error instanceof Error && error.message === 'Access denied';
    return NextResponse.json({ error: denied ? 'Access denied' : 'The document could not be restored.' }, { status: denied ? 403 : 400 });
  }
}
