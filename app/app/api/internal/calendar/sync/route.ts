import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncAllGoogleCalendarConnections } from '@/lib/google-calendar-sync';
import { beginJobRun, recordJobResult } from '@/lib/scheduled-job-runs';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const secret = process.env.CALENDAR_SYNC_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(secret ?? '');
  if (!secret || right.length < 32 || left.length !== right.length || !timingSafeEqual(left, right)) return new NextResponse('Not found', { status: 404 });
  const run = beginJobRun(prisma, 'CALENDAR_SYNC');
  try {
    const results = await syncAllGoogleCalendarConnections(prisma);
    const summary = { connections: results.length, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, processed: results.reduce((sum, r) => sum + r.processed, 0) };
    recordJobResult(prisma, run, { status: summary.failed ? 'FAILED' : 'SUCCEEDED', processedCount: summary.processed, resultSummary: `${summary.succeeded} of ${summary.connections} connections succeeded.`, errorSummary: summary.failed ? `${summary.failed} Calendar connection syncs failed. Review connection status.` : undefined });
    return NextResponse.json(summary);
  } catch {
    recordJobResult(prisma, run, { status: 'FAILED', errorSummary: 'Calendar sync failed. Review application logs.' });
    return NextResponse.json({ error: 'Calendar sync failed.' }, { status: 500 });
  }
}
