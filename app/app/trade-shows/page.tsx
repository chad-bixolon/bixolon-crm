import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { tradeShowKpis, tradeShowLeadReadWhere, tradeShowReadWhere } from '@/lib/trade-shows';

export const dynamic = 'force-dynamic';
export default async function TradeShowsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requirePermission('trade-shows.read');
  const { view } = await searchParams;
  const archived = view === 'archived';
  const shows = await prisma.tradeShow.findMany({
    where: { AND: [tradeShowReadWhere(actor), { archivedAt: archived ? { not: null } : null }] },
    include: { leads: { where: tradeShowLeadReadWhere(actor), select: { assignedSalesRepUserId: true, status: true } } },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
  });
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '—';
  return <Content><PageHeader eyebrow="Marketing" title="Trade Shows" description="Events and their captured lead outcomes." action={can(actor, 'trade-shows.manage') ? <Link className="btn-primary" href="/trade-shows/new">Create Trade Show</Link> : undefined}/>
    <div className="mb-4 flex gap-2 text-sm"><Link className={archived ? 'btn-secondary' : 'btn-primary'} href="/trade-shows">Active</Link><Link className={archived ? 'btn-primary' : 'btn-secondary'} href="/trade-shows?view=archived">Archived</Link></div>
    <div className="panel overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Trade Show','Dates','Location','Leads','Assigned','Contacted','Qualified','Converted'].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{shows.map(show => { const kpi = tradeShowKpis(show.leads); return <tr key={show.id}><td className="px-4 py-3"><Link className="font-semibold text-orange-800" href={`/trade-shows/${show.id}`}>{show.name}</Link></td><td className="px-4 py-3">{date(show.startDate)}{show.endDate && show.endDate.getTime() !== show.startDate?.getTime() ? ` – ${date(show.endDate)}` : ''}</td><td className="px-4 py-3">{show.location ?? '—'}</td><td className="px-4 py-3">{kpi.total}</td><td className="px-4 py-3">{kpi.assigned}</td><td className="px-4 py-3">{kpi.contacted}</td><td className="px-4 py-3">{kpi.qualified}</td><td className="px-4 py-3">{kpi.converted}</td></tr>; })}</tbody></table>{!shows.length && <p className="p-8 text-center text-sm text-slate-500">No {archived ? 'archived' : 'active'} Trade Shows yet.</p>}</div>
  </Content>;
}
