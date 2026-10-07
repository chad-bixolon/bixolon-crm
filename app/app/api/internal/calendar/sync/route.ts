import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncAllGoogleCalendarConnections } from '@/lib/google-calendar-sync';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const secret = process.env.CALENDAR_SYNC_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(secret ?? '');
  if (!secret || right.length < 32 || left.length !== right.length || !timingSafeEqual(left, right)) return new NextResponse('Not found', { status: 404 });
  const results = await syncAllGoogleCalendarConnections(prisma);
  return NextResponse.json({ connections: results.length, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, processed: results.reduce((sum, r) => sum + r.processed, 0) });
}
