import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runWeeklySnapshots, intendedSnapshotWeek } from '@/lib/weekly-snapshots';
import { jobLogger, warnInvalidJobSecret, correlationIdFromHeader } from '../../../../../lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const expected = Buffer.from(process.env.WEEKLY_SNAPSHOT_SECRET ?? '');
  const supplied = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { warnInvalidJobSecret('weekly-snapshots'); return new NextResponse('Not found', { status: 404 }); }
  let week: string | undefined;
  try {
    const text = await request.text();
    if (text.length > 100) throw new Error('Invalid input');
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'week') || (body.week !== undefined && typeof body.week !== 'string')) throw new Error('Invalid input');
    week = body.week;
    intendedSnapshotWeek(week, new Date());
  } catch { return NextResponse.json({ error: 'Use an optional Monday week date: YYYY-MM-DD.' }, { status: 400 }); }
  const log = jobLogger('weekly-snapshots', correlationIdFromHeader(request.headers.get('x-request-id')));
  try {
    const run = await runWeeklySnapshots(prisma, week);
    if (run.status === 'SUCCEEDED') log.completed({ runId: run.id });
    else log.failedOutcome({ runId: run.id, category: run.failureCategory ?? 'unknown' });
    return NextResponse.json({ id: run.id, status: run.status, week: run.snapshotWeek?.toISOString().slice(0, 10), opportunitySnapshotRunId: run.opportunitySnapshotRunId, forecastSnapshotRunId: run.forecastSnapshotRunId, failureCategory: run.failureCategory, message: run.errorSummary ?? run.resultSummary }, { status: run.status === 'SUCCEEDED' ? 200 : 503 });
  } catch (error) { log.failed(error); return NextResponse.json({ error: 'Weekly snapshot execution could not be recorded or completed. Retry the intended week and review Administration.' }, { status: 503 }); }
}
