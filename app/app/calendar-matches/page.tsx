import { NAV_CATEGORIES } from '../../lib/navigation-categories';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { prisma } from '@/lib/prisma';
import { currentUser, getRealAuthenticatedUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { evaluateCalendarEvent } from '@/lib/calendar-matching';
import { formatDateTimeForUser } from '@/lib/display-format';
import { ignoreCalendarEvent } from './actions';
import { calendarQueueWhere, type CalendarQueueStatus } from '@/lib/calendar-queue';

export const dynamic = 'force-dynamic';
const statuses = ['review', 'matched', 'suggested', 'unmatched', 'upcoming', 'logged', 'ignored', 'cancelled'] as const;
export default async function CalendarMatchesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; q?: string; from?: string; to?: string; accountId?: string }> }) {
  const real = await getRealAuthenticatedUser(); if (!real) redirect('/sign-in');
  const actor = await currentUser();
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId: real.id }, select: { id: true, googleEmail: true } });
  const p = await searchParams; const status = statuses.includes(p.status as typeof statuses[number]) ? p.status! : 'review';
  const page = Math.max(1, Math.min(1000, Number(p.page) || 1)); const now = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.from ?? '') ? new Date(`${p.from}T00:00:00Z`) : new Date(now.getTime() - 60 * 86400000);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.to ?? '') ? new Date(`${p.to}T23:59:59Z`) : new Date(now.getTime() + 90 * 86400000);
  if (connection && can(actor, 'contacts.read')) {
    const candidates = await prisma.googleCalendarEvent.findMany({ where: { connectionId: connection.id, userId: real.id, OR: [{ startAt: { gte: from, lte: to } }, { startDate: { gte: from.toISOString().slice(0, 10), lte: to.toISOString().slice(0, 10) } }] }, select: { id: true, updatedAt: true, review: { select: { updatedAt: true, activityId: true, ignoredAt: true } } }, orderBy: { id: 'desc' } });
    const stale = candidates.filter(event => !event.review || (!event.review.activityId && !event.review.ignoredAt && (event.review.updatedAt < event.updatedAt || event.review.updatedAt.getTime() < now.getTime() - 5 * 60000)));
    for (let offset = 0; offset < stale.length; offset += 8) await Promise.all(stale.slice(offset, offset + 8).map(event => evaluateCalendarEvent(prisma, event.id, actor, connection.googleEmail)));
  }
  const accountId = Number(p.accountId); const q = (p.q ?? '').trim().slice(0, 100);
  const dateWhere = calendarQueueWhere({ userId: real.id, from, to, now, status: status as CalendarQueueStatus, search: q, accountId });
  const [count, events, zone, accounts] = connection ? await Promise.all([
    prisma.googleCalendarEvent.count({ where: dateWhere }),
    prisma.googleCalendarEvent.findMany({ where: dateWhere, include: { attendees: true, review: true }, orderBy: [{ startAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20 }),
    prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } }),
    prisma.account.findMany({ where: { archivedAt: null, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]) : [0, [], null, []];
  const ids = { contacts: new Set<number>(), accounts: new Set<number>(), opportunities: new Set<number>(), projects: new Set<number>() };
  for (const event of events) { const r = event.review; if (!r) continue; (r.selectionsConfirmed ? r.selectedContactIds : r.suggestedContactIds).forEach(id => ids.contacts.add(id)); if (r.selectedAccountId ?? r.suggestedAccountId) ids.accounts.add((r.selectionsConfirmed ? r.selectedAccountId : r.suggestedAccountId)!); if (r.selectedOpportunityId ?? r.suggestedOpportunityId) ids.opportunities.add((r.selectionsConfirmed ? r.selectedOpportunityId : r.suggestedOpportunityId)!); if (r.selectedProjectId ?? r.suggestedProjectId) ids.projects.add((r.selectionsConfirmed ? r.selectedProjectId : r.suggestedProjectId)!); }
  const [contacts, matchedAccounts, opportunities, projects] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: [...ids.contacts] } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.account.findMany({ where: { id: { in: [...ids.accounts] } }, select: { id: true, name: true } }),
    prisma.opportunity.findMany({ where: { id: { in: [...ids.opportunities] } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: [...ids.projects] } }, select: { id: true, name: true } }),
  ]);
  const name = (list: { id: number; name: string }[], id: number | null, fallback: string) => id ? list.find(x => x.id === id)?.name || fallback : '—';
  const contactNames = contacts.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }));
  const link = (next: number) => `/calendar-matches?${new URLSearchParams({ status, page: String(next), ...(q ? { q } : {}), ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}), ...(accountId > 0 ? { accountId: String(accountId) } : {}) })}`;
  return <Content><PageHeader title="Calendar Matches" eyebrow={NAV_CATEGORIES.sales} description="Review customer meetings from Google Calendar before logging them as SalesHub Activities." action={<Link className="btn-secondary" href="/my-integrations">My integrations</Link>}/>
    {!connection ? <div className="panel p-6"><p>Connect your Google Calendar in My integrations to review meetings here.</p><Link className="btn-primary mt-4" href="/my-integrations">Connect Calendar</Link></div> : <>
      <nav aria-label="Review status" className="mb-4 flex flex-wrap gap-2">{statuses.map(s => <Link key={s} className={s === status ? 'btn-primary' : 'btn-secondary'} href={`/calendar-matches?status=${s}`}>{s === 'review' ? 'Needs Review' : s[0].toUpperCase() + s.slice(1)}</Link>)}</nav>
      <form className="panel filter-panel filter-grid filter-row mb-5" method="get"><input type="hidden" name="status" value={status}/><label className="label">Search<input className="field filter-control" name="q" defaultValue={q}/></label><label className="label">From<input className="field filter-control" type="date" name="from" defaultValue={p.from ?? ''}/></label><label className="label">To<input className="field filter-control" type="date" name="to" defaultValue={p.to ?? ''}/></label><label className="label">Account<select className="field filter-control" name="accountId" defaultValue={accountId > 0 ? accountId : ''}><option value="">All Accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="filter-actions"><button className="btn-filter-primary">Apply</button></div></form>
      <p className="mb-3 text-sm text-slate-600">{count} meetings · {zone?.timeZone ?? 'America/New_York'}</p>
      <div className="space-y-3">{events.map(event => { const r = event.review; const selected = !!r?.selectionsConfirmed; const contactIds = selected ? r!.selectedContactIds : r?.suggestedContactIds ?? []; const account = selected ? r!.selectedAccountId : r?.suggestedAccountId ?? null; const opportunity = selected ? r!.selectedOpportunityId : r?.suggestedOpportunityId ?? null; const project = selected ? r!.selectedProjectId : r?.suggestedProjectId ?? null; const ended = (event.endAt ?? (event.endDate ? new Date(`${event.endDate}T00:00:00Z`) : null))! <= now; const loggable = ended && !event.cancelledAt && event.status !== 'CANCELLED' && !r?.activityId && !r?.ignoredAt && !!account && (r?.matchStatus === "MATCHED" || !!r?.selectionsConfirmed) && can(actor, 'tasks.write'); return <article className="panel space-y-2 p-5" key={event.id}><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-lg font-semibold">{event.summary || 'Calendar event'}</h2><span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">{r?.activityId ? 'Logged' : r?.ignoredAt ? 'Ignored' : event.cancelledAt ? 'Cancelled' : r?.matchStatus ?? 'Unmatched'}</span></div><p className="text-sm text-slate-700">{event.allDay ? `${event.startDate} · All day` : event.startAt ? formatDateTimeForUser(event.startAt, zone?.timeZone ?? 'America/New_York') : 'Time unavailable'}{event.startAt && event.endAt ? ` · ${Math.max(0, Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60000))} min` : ''}</p><p className="text-sm">Contacts: {contactIds.map(id => name(contactNames, id, 'Contact')).join(', ') || '—'} · Account: {name(matchedAccounts, account, 'Account')}</p><p className="text-sm">Opportunity: {name(opportunities, opportunity, 'Opportunity')} · Project: {name(projects, project, 'Project')}</p>{r?.explanations?.[0] && <p className="text-sm text-slate-600">{r.explanations[0]}</p>}<p className="text-xs text-slate-600">{event.attendees.length} attendee{event.attendees.length === 1 ? '' : 's'} · {event.attendees.filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 3).join(', ')}</p><div className="flex flex-wrap gap-2">{r?.activityId ? <Link className="btn-secondary" href={`/activities/${r.activityId}/edit`}>View Activity</Link> : <><Link className="btn-secondary" href={`/calendar-matches/${event.id}`}>Review / Change Match</Link>{loggable && <Link className="btn-primary" href={`/calendar-matches/${event.id}/log`}>Log as Activity</Link>}{!r?.ignoredAt && <form action={ignoreCalendarEvent}><input type="hidden" name="eventId" value={event.id}/><button className="btn-secondary">Ignore</button></form>}</>}</div></article>; })}</div>
      {!events.length && <p className="panel p-6 text-sm text-slate-600">No meetings in this view.</p>}
      <nav className="mt-5 flex gap-3 text-sm">{page > 1 && <Link className="btn-secondary" href={link(page - 1)}>Previous</Link>}{page * 20 < count && <Link className="btn-secondary" href={link(page + 1)}>Next</Link>}</nav>
    </>}</Content>;
}
