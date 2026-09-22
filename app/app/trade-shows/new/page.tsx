import { Content, PageHeader } from '@/components/shell';
import { TradeShowForm } from '@/components/trade-show-form';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';

export const dynamic = 'force-dynamic';
export default async function NewTradeShowPage() {
  await requirePermission('trade-shows.manage');
  const owners = await prisma.user.findMany({ where: { role: 'MARKETING_MANAGER', active: true, archivedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  return <Content><PageHeader eyebrow="Trade Shows" title="New Trade Show"/><TradeShowForm owners={owners}/></Content>;
}
