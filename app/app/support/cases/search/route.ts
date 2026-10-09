import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { rankCatalogResults } from '@/lib/catalog-search';
import { searchEntities } from '@/lib/entity-search';

export async function GET(request: NextRequest) {
  const actor = await requirePermission('support-cases.write');
  const kind = request.nextUrl.searchParams.get('kind');
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const accountId = Number(request.nextUrl.searchParams.get('accountId'));
  if (kind === 'account' || kind === 'contact') return NextResponse.json({ results: kind === 'contact' && (!Number.isSafeInteger(accountId) || accountId < 1) ? [] : await searchEntities(prisma, actor, kind, q, kind === 'contact' ? { accountId } : {}) });
  if (kind === 'sku') {
    const search = (mode: 'equals' | 'startsWith' | 'contains') => prisma.productSku.findMany({ where: { active: true, ...(q ? { OR: [{ partNumber: { [mode]: q, mode: 'insensitive' as const } }, { product: { name: { [mode]: q, mode: 'insensitive' as const } } }, { product: { sku: { [mode]: q, mode: 'insensitive' as const } } }] } : {}) }, select: { id: true, partNumber: true, description: true, product: { select: { name: true, sku: true } } }, orderBy: { partNumber: 'asc' }, take: 25 });
    const exactPartNumber = q ? await prisma.productSku.findMany({ where: { active: true, partNumber: { equals: q, mode: 'insensitive' } }, select: { id: true, partNumber: true, description: true, product: { select: { name: true, sku: true } } }, take: 25 }) : [];
    const batches = q ? await Promise.all([search('equals'), search('startsWith'), search('contains')]) : [await search('contains')];
    const rows = [...new Map([exactPartNumber, ...batches].flat().map(row => [row.id, row])).values()];
    return NextResponse.json({ results: rankCatalogResults(rows, q).map(row => ({ id: row.id, name: `${row.partNumber} · ${row.product.name}` })) });
  }
  return NextResponse.json({ results: [] }, { status: 400 });
}
