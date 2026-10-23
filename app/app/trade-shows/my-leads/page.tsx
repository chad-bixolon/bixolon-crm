import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { TableScroll } from '@/components/table-scroll';
import { SavedViews } from '@/components/saved-views';
import { FilterDisclosure } from '@/components/filter-disclosure';
import { TaskDuePeriod } from '@/components/task-due-period';
import { TradeShowFollowUpTask } from '@/components/trade-show-follow-up-task';
import { countTaskFilters } from '@/lib/filter-count';
import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { eligibleUserWhere } from '@/lib/assignment-eligibility';
import { can } from '@/lib/authorization';
import { tradeShowLeadReadWhere } from '@/lib/trade-shows';
import { canViewTradeShowFollowUpQueue, loadTradeShowQueue, type TradeShowQueueFilters } from '@/lib/trade-show-queue';
import { getModuleAvailability } from '@/lib/module-availability';

export const dynamic = 'force-dynamic';
const statusLabels = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CONVERTED: 'Converted', DISQUALIFIED: 'Disqualified' };
export default async function MyTradeShowLeadsPage({ searchParams }: { searchParams: Promise<TradeShowQueueFilters> }) {
  const actor = await currentUser();
  const availability = await getModuleAvailability();
  if (!canViewTradeShowFollowUpQueue(actor)) redirect('/access-denied');
  const f = await searchParams, now = new Date();
  const [{ leads, count, page, pages }, shows, reps] = await Promise.all([
    loadTradeShowQueue(prisma, actor, f, now),
    prisma.tradeShow.findMany({ where: { archivedAt: null, leads: { some: tradeShowLeadReadWhere(actor) } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: eligibleUserWhere('general-task'), select: { id: true, firstName: true, lastName: true, role: true }, orderBy: { firstName: 'asc' } }),
  ]);
  const allAllowed = actor.role === 'ADMIN' || actor.role === 'SALES_MANAGER';
  const clear = f.view === 'all' || actor.role === 'MARKETING_MANAGER' ? '/trade-shows/my-leads?view=all' : '/trade-shows/my-leads?view=mine';
  const linkFor = (target: number) => { const q = new URLSearchParams(); Object.entries(f).forEach(([key, value]) => { if (value && key !== 'page') q.set(key, value); }); q.set('page', String(target)); return `/trade-shows/my-leads?${q}`; };
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '—';
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.marketing} title="Trade Show Follow-Up Queue" description="Work event leads and open their latest follow-up Task." action={<Link className="btn-secondary" href="/trade-shows">Trade Shows</Link>}/>
    <SavedViews routeKey="trade-show-follow-up" query={f}/>
    {allAllowed && <nav className="mb-4 flex gap-2" aria-label="Lead ownership"><Link className={f.view === 'all' ? 'btn-filter-secondary' : 'btn-filter-primary'} href="/trade-shows/my-leads?view=mine">My Leads</Link><Link className={f.view === 'all' ? 'btn-filter-primary' : 'btn-filter-secondary'} href="/trade-shows/my-leads?view=all">All Assigned Leads</Link></nav>}
    <form key={JSON.stringify(f)} className="responsive-filter-form panel filter-panel filter-grid mb-5" method="get" aria-label="Filter follow-up queue">
      {f.view && <input type="hidden" name="view" value={f.view}/>}
      <label className="label filter-primary-search">Search<input className="field filter-control" name="q" defaultValue={f.q ?? ''} placeholder="Lead, company or email"/></label>
      <button type="submit" className="filter-mobile-search-submit">Search</button>
      <FilterDisclosure initialCount={countTaskFilters(f)} defaults={{}} taskDuePeriod clearHref={clear}/>
      <div><label className="label" htmlFor="queue-status">Lead status</label><select id="queue-status" className="field filter-control" name="status" defaultValue={f.status ?? ''}><option value="">Actionable</option><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label className="label" htmlFor="queue-tradeShowId">Trade Show</label><select id="queue-tradeShowId" className="field filter-control" name="tradeShowId" defaultValue={f.tradeShowId ?? ''}><option value="">All Trade Shows</option>{shows.map(show => <option key={show.id} value={show.id}>{show.name}</option>)}</select></div>
      <div><label className="label" htmlFor="queue-taskStatus">Task status</label><select id="queue-taskStatus" className="field filter-control" name="taskStatus" defaultValue={f.taskStatus ?? ''}><option value="">All Tasks</option><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="none">No follow-up Task</option></select></div>
      <div><label className="label" htmlFor="queue-mine">Task assignment</label><select id="queue-mine" className="field filter-control" name="mine" defaultValue={f.mine ?? ''}><option value="">All assignees</option><option value="yes">Assigned to me</option></select></div>
      {actor.role !== 'SALES' && <>
        <div><label className="label" htmlFor="queue-ownerId">Lead owner</label><select id="queue-ownerId" className="field filter-control" name="ownerId" defaultValue={f.ownerId ?? ''}><option value="">All owners</option>{reps.filter(rep => ['SALES','SALES_MANAGER'].includes(rep.role)).map(rep => <option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}</option>)}</select></div>
      </>}
        <div><label className="label" htmlFor="queue-assignedToId">Task assignee</label><select id="queue-assignedToId" className="field filter-control" name="assignedToId" defaultValue={f.assignedToId ?? ''}><option value="">All assignees</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}</option>)}</select></div>
      <TaskDuePeriod key={JSON.stringify([f.duePeriod, f.dueFrom, f.dueTo])} initial={f} label="Task due date"/>
      <div className="filter-actions"><button className="btn-filter-primary">Filter</button><Link className="btn-filter-secondary" href={clear}>Clear</Link></div>
    </form>
    <section className="panel min-w-0 max-w-full overflow-hidden"><TableScroll label="Trade Show follow-up queue"><table className="w-full min-w-[960px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Lead / CRM','Trade Show','Lead status','Lead owner','Lead follow-up metadata','Follow-up Task'].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{leads.map(lead => <tr className="align-top even:bg-slate-50/60 hover:bg-orange-50/50" key={lead.id}>
      <td className="max-w-64 break-words px-4 py-3"><Link className="font-semibold text-orange-800 underline" href={`/trade-shows/${lead.tradeShowId}/leads/${lead.id}`}>{lead.firstName} {lead.lastName}</Link><div>{lead.sourceCompany}</div><div className="mt-1 space-y-1 text-xs">{lead.account && can(actor, 'accounts.read') && <Link className="block text-orange-800 underline" href={`/accounts/${lead.account.id}`}>{lead.account.name}</Link>}{lead.contact && can(actor, 'contacts.read') && <Link className="block text-orange-800 underline" href={`/contacts/${lead.contact.id}`}>{lead.contact.firstName} {lead.contact.lastName}</Link>}{availability.effective.has('OPPORTUNITIES') && lead.convertedOpportunity && can(actor, 'opportunities.read') && <Link className="block text-orange-800 underline" href={`/opportunities/${lead.convertedOpportunity.id}`}>{lead.convertedOpportunity.name}</Link>}</div></td>
      <td className="max-w-48 break-words px-4 py-3"><Link className="text-orange-800 underline" href={`/trade-shows/${lead.tradeShowId}`}>{lead.tradeShow.name}</Link></td>
      <td className="px-4 py-3">{statusLabels[lead.status]}</td><td className="px-4 py-3">{lead.assignedSalesRep ? `${lead.assignedSalesRep.firstName} ${lead.assignedSalesRep.lastName}` : 'Unassigned'}</td>
      <td className="px-4 py-3 text-xs">Lead follow-up: {date(lead.followUpAt)}{lead.lastContactedAt && <div className="mt-1 text-slate-500">Last contact: {date(lead.lastContactedAt)}</div>}</td>
      <td className="max-w-72 px-4 py-3"><TradeShowFollowUpTask task={lead.followUpTasks[0]} now={now}/></td>
    </tr>)}</tbody></table></TableScroll>{!leads.length && <p className="p-8 text-center text-sm text-slate-500">No leads match this follow-up queue.</p>}</section>
    <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm"><span>{count} leads · Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={linkFor(page - 1)}>Previous</Link>}{page < pages && <Link className="btn-secondary" href={linkFor(page + 1)}>Next</Link>}</div></div>
  </Content>;
}
