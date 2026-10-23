import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { globalSearch } from '@/lib/global-search';
import { getModuleAvailability } from '@/lib/module-availability';

export async function GET(request: NextRequest) {
  try {
    const results = await globalSearch(prisma, await currentUser(), request.nextUrl.searchParams.get('q') ?? '', await getModuleAvailability());
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Search is unavailable.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } }); }
}
