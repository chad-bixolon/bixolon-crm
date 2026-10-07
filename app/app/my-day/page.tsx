import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser, getRealAuthenticatedUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { formatDateTimeForUser } from '@/lib/display-format';
import { DEFAULT_USER_TIME_ZONE } from '@/lib/user-time-zone';
import { durationLabel, getMyDaySummary, myDayToday } from '@/lib/my-day';

export const dynamic = 'force-dynamic';
export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const real = await getRealAuthenticatedUser();
  if (!real) redirect('/sign-in');
  const actor = await currentUser();
  const user = await prisma.user.findUnique({ where: { id: real.id }, select: { timeZone: true } });
  const zone = user?.timeZone ?? DEFAULT_USER_TIME_ZONE;
  const today = myDayToday(new Date(), zone);
  const requested = (await searchParams).date;
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(`${requested}T00:00:00Z`)) && new Date(`${requested}T00:00:00Z`).toISOString().slice(0, 10) === requested ? requested : today;
  const summary = await getMyDaySummary(prisma, real.id, date, zone, new Date(), actor);
  const day = new Date(`${date}T00:00:00Z`);
  const move = (offset: number) => new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const cards = [
    ['Customer meetings', String(summary.customerMeetingCount)],
    ['Customer-facing time', durationLabel(summary.customerMeetingMinutes)],
    ['Internal meeting time', durationLabel(summary.internalMeetingMinutes)],
    ['Completed Activities', String(summary.completedActivityCount)],
    ['Completed Tasks', String(summary.completedTaskCount)],
    ['Open Tasks due today', String(summary.dueTodayTaskCount)],
  ];
  return <Content>
    <PageHeader title="My Day" description={`${new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(day)} · ${zone}`} action={<Link className="btn-secondary" href="/">Dashboard</Link>} />
    <div className="mb-5 flex flex-wrap items-end gap-2"><Link className="btn-secondary" href={`/my-day?date=${move(-1)}`}>Previous day</Link><Link className="btn-secondary" href="/my-day">Today</Link><Link className="btn-secondary" href={`/my-day?date=${move(1)}`}>Next day</Link><form className="flex items-end gap-2"><div><label className="label" htmlFor="my-day-date">Date</label><input className="field" id="my-day-date" name="date" type="date" defaultValue={date} /></div><button className="btn-filter-primary" type="submit">View</button></form></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <section className="panel min-w-0 p-4" key={label}><h2 className="text-sm text-slate-600">{label}</h2><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></section>)}</div>
    <section className="panel min-w-0 p-5"><h2 className="mb-4 text-lg font-semibold">Daily timeline</h2>{summary.timeline.length ? <ol className="divide-y">{summary.timeline.map(entry => <li className="flex min-w-0 gap-4 py-3" key={entry.key}><time className="w-24 shrink-0 text-sm text-slate-600">{entry.at ? formatDateTimeForUser(entry.at, zone).split(' at ')[1] : 'Due today'}</time><div className="min-w-0"><p className="break-words font-medium">{entry.title}</p><p className="text-sm text-slate-600">{entry.detail}</p>{entry.href && <Link className="text-sm text-orange-800 underline" href={entry.href}>{entry.kind === 'customer' && entry.detail.includes('Needs review') ? 'Review Calendar Match' : 'View details'}</Link>}</div></li>)}</ol> : <p className="text-sm text-slate-600">No Calendar meetings, Activities, or Tasks for this day.</p>}</section>
    {summary.overdueTaskCount > 0 && <p className="mt-4 text-sm text-slate-600">{summary.overdueTaskCount} overdue Task{summary.overdueTaskCount === 1 ? '' : 's'} assigned to you.</p>}
  </Content>;
}
