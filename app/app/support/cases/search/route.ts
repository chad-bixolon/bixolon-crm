import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { rankCatalogResults } from '@/lib/catalog-search';

export async function GET(request: NextRequest) {
  await requirePermission('support-cases.write');
  const kind = request.nextUrl.searchParams.get('kind');
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const accountId = Number(request.nextUrl.searchParams.get('accountId'));
  const contains = { contains: q, mode: 'insensitive' as const };
  if (kind === 'account') return NextResponse.json({ results: await prisma.account.findMany({ where: { status: 'ACTIVE', archivedAt: null, ...(q ? { name: contains } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 30 }) });
  if (kind === 'contact') return NextResponse.json({ results: Number.isSafeInteger(accountId) && accountId > 0 ? await prisma.contact.findMany({ where: { accountId, active: true, archivedAt: null, ...(q ? { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } : {}) }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 30 }).then(rows => rows.map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }))) : [] });
  if (kind === 'sku') {
    const search = (mode: 'equals' | 'startsWith' | 'contains') => prisma.productSku.findMany({ where: { active: true, ...(q ? { OR: [{ partNumber: { [mode]: q, mode: 'insensitive' as const } }, { product: { name: { [mode]: q, mode: 'insensitive' as const } } }, { product: { sku: { [mode]: q, mode: 'insensitive' as const } } }] } : {}) }, select: { id: true, partNumber: true, description: true, product: { select: { name: true, sku: true } } }, orderBy: { partNumber: 'asc' }, take: 25 });
    const batches = q ? await Promise.all([search('equals'), search('startsWith'), search('contains')]) : [await search('contains')];
    const rows = [...new Map(batches.flat().map(row => [row.id, row])).values()];
    return NextResponse.json({ results: rankCatalogResults(rows, q).map(row => ({ id: row.id, name: `${row.partNumber} · ${row.product.name}` })) });
  }
  return NextResponse.json({ results: [] }, { status: 400 });
}
