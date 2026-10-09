import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { searchEntities, type EntityType } from '@/lib/entity-search';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type');
  if (!['account', 'contact', 'opportunity', 'project'].includes(type ?? '')) return NextResponse.json({ results: [] }, { status: 400 });
  const params = request.nextUrl.searchParams;
  const positive = (key: string) => { const value = Number(params.get(key)); return Number.isSafeInteger(value) && value > 0 ? value : undefined; };
  try {
    const results = await searchEntities(prisma, await currentUser(), type as EntityType, params.get('q') ?? '', {
      accountId: positive('accountId'), opportunityId: positive('opportunityId'), projectId: positive('projectId'), excludeProjectId: positive('excludeProjectId'), openOnly: params.get('openOnly') === 'true',
      projectStatus: params.get('projectStatus') === 'PLANNING' || params.get('projectStatus') === 'ACTIVE' ? params.get('projectStatus') as 'PLANNING' | 'ACTIVE' : undefined,
      partnerOnly: params.get('partnerOnly') === 'true', editableOnly: params.get('editableOnly') === 'true',
      includeUnassigned: params.get('includeUnassigned') === 'true',
    });
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Search is unavailable.' }, { status: 403 });
  }
}
