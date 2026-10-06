import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { evaluatePeNotifications } from '@/lib/pe-notification-evaluator';
import { evaluateWorkNotifications } from '@/lib/work-notification-evaluator';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const secret = process.env.NOTIFICATION_EVALUATOR_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const suppliedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret ?? '');
  if (!secret || secretBytes.length < 32 || suppliedBytes.length !== secretBytes.length || !timingSafeEqual(suppliedBytes, secretBytes)) return new NextResponse('Not found', { status: 404 });
  const [pe, work] = await Promise.all([evaluatePeNotifications(prisma), evaluateWorkNotifications(prisma)]);
  const evaluated = { priceExceptions: pe.evaluated, ...work.evaluated };
  const created = { priceExceptions: pe.created, ...work.created };
  const resolved = { priceExceptions: pe.resolved, ...work.resolved };
  return NextResponse.json({ evaluated, created, resolved, totals: { evaluated: Object.values(evaluated).reduce((a, b) => a + b, 0), created: Object.values(created).reduce((a, b) => a + b, 0), resolved: Object.values(resolved).reduce((a, b) => a + b, 0) } });
}
