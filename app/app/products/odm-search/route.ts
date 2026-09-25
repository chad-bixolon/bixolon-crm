import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  await requirePermission('products.read');
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const kind = request.nextUrl.searchParams.get('kind');
  if (!q) return NextResponse.json({ items: [] });
  if (kind === 'account') {
    await requirePermission('accounts.read');
    const normalized = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    const items = await prisma.$queryRaw<{ id: number; name: string }[]>`
      SELECT id, name FROM "Account"
      WHERE status = 'ACTIVE' AND "archivedAt" IS NULL
        AND (strpos(lower(name), lower(${q})) > 0
          OR (${normalized} <> '' AND strpos(regexp_replace(lower(name), '[^a-z0-9]', '', 'g'), ${normalized}) > 0))
      ORDER BY name ASC LIMIT 20
    `;
    return NextResponse.json({ items: items.map(item => ({ id: item.id, label: item.name })) });
  }
  if (kind === 'baseSku') {
    const items = await prisma.productSku.findMany({ where: { catalogSource: { not: 'ODM' }, active: true, product: { active: true, archivedAt: null }, OR: [{ partNumber: { contains: q, mode: 'insensitive' } }, { product: { name: { contains: q, mode: 'insensitive' } } }, { description: { contains: q, mode: 'insensitive' } }] }, select: { id: true, partNumber: true, product: { select: { name: true } } }, orderBy: { partNumber: 'asc' }, take: 20 });
    return NextResponse.json({ items: items.map(item => ({ id: item.id, label: `${item.partNumber} · ${item.product.name}` })) });
  }
  return NextResponse.json({ error: 'Invalid search' }, { status: 400 });
}
