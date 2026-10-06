import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { evaluatePeNotifications } from '@/lib/pe-notification-evaluator';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const secret = process.env.NOTIFICATION_EVALUATOR_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const suppliedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret ?? '');
  if (!secret || secretBytes.length < 32 || suppliedBytes.length !== secretBytes.length || !timingSafeEqual(suppliedBytes, secretBytes)) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(await evaluatePeNotifications(prisma));
}
