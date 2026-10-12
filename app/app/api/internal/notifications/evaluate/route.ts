import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { evaluatePeNotifications } from '@/lib/pe-notification-evaluator';
import { evaluateWorkNotifications } from '@/lib/work-notification-evaluator';
import { evaluateSupportNotifications } from '@/lib/support-notifications';
import { beginJobRun, recordJobResult } from '@/lib/scheduled-job-runs';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const secret = process.env.NOTIFICATION_EVALUATOR_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const suppliedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret ?? '');
  if (!secret || secretBytes.length < 32 || suppliedBytes.length !== secretBytes.length || !timingSafeEqual(suppliedBytes, secretBytes)) return new NextResponse('Not found', { status: 404 });
  const run = beginJobRun(prisma, 'NOTIFICATION_EVALUATOR');
  try {
    const [pe, work, support] = await Promise.all([evaluatePeNotifications(prisma), evaluateWorkNotifications(prisma), evaluateSupportNotifications(prisma)]);
    const evaluated = { priceExceptions: pe.evaluated, ...work.evaluated, supportCases: support.evaluated };
    const created = { priceExceptions: pe.created, ...work.created, supportCases: support.created };
    const resolved = { priceExceptions: pe.resolved, ...work.resolved, supportCases: support.resolved };
    const totals = { evaluated: Object.values(evaluated).reduce((a, b) => a + b, 0), created: Object.values(created).reduce((a, b) => a + b, 0), resolved: Object.values(resolved).reduce((a, b) => a + b, 0) };
    recordJobResult(prisma, run, { status: 'SUCCEEDED', processedCount: totals.evaluated, createdCount: totals.created, resolvedCount: totals.resolved, resultSummary: 'Daily condition evaluation completed.' });
    return NextResponse.json({ evaluated, created, resolved, totals });
  } catch {
    recordJobResult(prisma, run, { status: 'FAILED', errorSummary: 'Notification evaluation failed. Review application logs.' });
    return NextResponse.json({ error: 'Notification evaluation failed.' }, { status: 500 });
  }
}
