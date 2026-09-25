import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { tradeShowKpis, tradeShowLeadReadWhere, tradeShowReadWhere } from '@/lib/trade-shows';
import { canViewSalesLeadQueue } from '@/lib/trade-show-leads';

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
  const date = (value: Date | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(value) : '—';
  return <Content><PageHeader eyebrow="Marketing" title="Trade Shows" description="Events and their captured lead outcomes." action={can(actor, 'trade-shows.manage') ? <div className="flex gap-2"><Link className="btn-secondary" href="/trade-shows/import-mappings">Import Mappings</Link><Link className="btn-primary" href="/trade-shows/new">Create Trade Show</Link></div> : undefined}/>
    <nav className="mb-4 flex gap-2" aria-label="Trade Show view"><Link className={archived ? 'btn-filter-secondary' : 'btn-filter-primary'} href="/trade-shows" aria-current={archived ? undefined : 'page'}>Active</Link><Link className={archived ? 'btn-filter-primary' : 'btn-filter-secondary'} href="/trade-shows?view=archived" aria-current={archived ? 'page' : undefined}>Archived</Link>{canViewSalesLeadQueue(actor)&&<Link className="btn-filter-secondary" href="/trade-shows/my-leads">My Leads</Link>}</nav>
    <div className="panel min-w-0 max-w-full overflow-hidden"><table className="w-full table-fixed text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="w-[22%] px-3 py-3 sm:px-4">Trade Show</th><th className="w-[30%] px-3 py-3 sm:px-4">Event</th><th className="w-[16%] px-3 py-3 sm:px-4">Leads</th><th className="w-[16%] px-3 py-3 sm:px-4">Follow-Up</th><th className="w-[16%] px-3 py-3 sm:px-4">Conversion</th></tr></thead><tbody className="divide-y">{shows.map(show => { const kpi = tradeShowKpis(show.leads); const rate = kpi.total ? Math.round(kpi.converted / kpi.total * 1000) / 10 : 0; return <tr className="even:bg-slate-50/60 hover:bg-orange-50/50 focus-within:bg-orange-50/50" key={show.id}><td className="break-words px-3 py-3 align-top sm:px-4"><Link className="font-semibold text-orange-800 hover:underline" href={`/trade-shows/${show.id}`}>{show.name}</Link></td><td className="break-words px-3 py-3 align-top sm:px-4"><span className="block">{date(show.startDate)}{show.endDate && show.endDate.getTime() !== show.startDate?.getTime() ? ` – ${date(show.endDate)}` : ''}</span><span className="mt-1 block text-xs text-slate-500">{show.location ?? 'Location not set'}</span></td><td className="px-3 py-3 align-top tabular-nums sm:px-4"><span className="block font-semibold">{kpi.total} total</span><span className="text-xs text-slate-500">{kpi.assigned} assigned</span></td><td className="px-3 py-3 align-top tabular-nums sm:px-4"><span className="block">{kpi.contacted} contacted</span><span className="text-xs text-slate-500">{kpi.qualified} qualified</span></td><td className="px-3 py-3 align-top tabular-nums sm:px-4"><span className="block">{kpi.converted} converted</span><span className="text-xs text-slate-500">{rate}% rate</span></td></tr>; })}</tbody></table>{!shows.length && <p className="p-8 text-center text-sm text-slate-500">No {archived ? 'archived' : 'active'} Trade Shows yet.</p>}</div>
  </Content>;
}
