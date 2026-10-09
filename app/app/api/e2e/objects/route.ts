import { NextResponse } from 'next/server';
import { readLocalSignedObject } from '@/lib/document-storage';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const body = await readLocalSignedObject(query.get('key') || '', Number(query.get('expires')), query.get('signature') || '');
    const name = (query.get('name') || 'attachment').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return new NextResponse(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Attachment not available.' }, { status: 404 }); }
}
