import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { listRecentItems } from '@/lib/recent-items';

export async function GET() {
  const actor = await currentUser();
  return NextResponse.json({ items: await listRecentItems(prisma, actor) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
