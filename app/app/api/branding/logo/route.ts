import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBranding } from '@/lib/deployment-branding';
import { documentStorage } from '@/lib/document-storage';
import { validateBrandingLogo } from '@/lib/branding-logo';
import { setBrandingLogo } from '@/lib/branding-admin';
import { requireMutation } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export async function GET() {
  const branding = await getBranding(prisma);
  if (!branding.logoStorageKey || !branding.logoMimeType) return NextResponse.redirect(new URL('/brand/bixolon-logo.png', process.env.AUTH_URL || 'http://localhost:3000'), { headers: noStore });
  try {
    const bytes = await documentStorage.readBrandingObject(branding.logoStorageKey);
    return new Response(Buffer.from(bytes), { headers: { ...noStore, 'Content-Type': branding.logoMimeType } });
  } catch { return new Response('Logo unavailable', { status: 503, headers: noStore }); }
}

export async function POST(request: Request) {
  let actor;
  try { actor = await requireMutation('deployment.manage'); }
  catch { return NextResponse.json({ error: 'Access denied.' }, { status: 403 }); }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 2 * 1024 * 1024) return NextResponse.json({ error: 'Logo must be 1 MB or smaller.' }, { status: 413 });
  try {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) throw new Error('Choose a PNG, JPEG, or WebP image.');
    await setBrandingLogo(prisma, documentStorage, actor, await validateBrandingLogo(file));
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not upload logo.' }, { status: 400 }); }
}

export async function DELETE() {
  let actor;
  try { actor = await requireMutation('deployment.manage'); }
  catch { return NextResponse.json({ error: 'Access denied.' }, { status: 403 }); }
  try { await setBrandingLogo(prisma, documentStorage, actor, null); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: 'Could not reset logo.' }, { status: 400 }); }
}
