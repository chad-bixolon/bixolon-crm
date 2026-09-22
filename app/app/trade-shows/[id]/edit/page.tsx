import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { TradeShowForm } from '@/components/trade-show-form';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';

export const dynamic = 'force-dynamic';
export default async function EditTradeShowPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('trade-shows.manage');
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const [show, owners] = await Promise.all([
    prisma.tradeShow.findUnique({ where: { id } }),
    prisma.user.findMany({ where: { role: 'MARKETING_MANAGER', active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
  ]);
  if (!show) notFound();
  return <Content><PageHeader eyebrow="Trade Shows" title={`Edit ${show.name}`}/>{show.archivedAt ? <div className="panel p-6">Reactivate this Trade Show before editing it.</div> : <TradeShowForm id={id} initial={show} owners={owners}/>}</Content>;
}
