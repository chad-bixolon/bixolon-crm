import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  await requirePermission('products.read');
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const kind = request.nextUrl.searchParams.get('kind');
  if (q.length < 2) return NextResponse.json({ items: [] });
  if (kind === 'account') {
    await requirePermission('accounts.read');
    const items = await prisma.account.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
    return NextResponse.json({ items: items.map(item => ({ id: item.id, label: item.name })) });
  }
  if (kind === 'baseSku') {
    const items = await prisma.productSku.findMany({ where: { catalogSource: { not: 'ODM' }, OR: [{ partNumber: { contains: q, mode: 'insensitive' } }, { product: { name: { contains: q, mode: 'insensitive' } } }, { description: { contains: q, mode: 'insensitive' } }] }, select: { id: true, partNumber: true, product: { select: { name: true } } }, orderBy: { partNumber: 'asc' }, take: 20 });
    return NextResponse.json({ items: items.map(item => ({ id: item.id, label: `${item.partNumber} · ${item.product.name}` })) });
  }
  return NextResponse.json({ error: 'Invalid search' }, { status: 400 });
}
