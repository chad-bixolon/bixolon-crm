import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { can } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { forecastForRep, quarters } from '@/lib/forecast';
import { formatCurrency } from '@/lib/display-format';
export const dynamic = 'force-dynamic';
type Filters = { userId?: string; year?: string; quarter?: string; currencyCode?: string };
export default async function ForecastPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await currentUser();
  if (!can(actor, 'sales.read')) notFound();
  const f = await searchParams;
  const [users, currencies] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ['SALES','SALES_MANAGER'] }, active: true, archivedAt: null, ...(actor.role === 'SALES' ? { id: actor.id } : {}) }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
  ]);
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const part = (kind: string) => Number(today.find(item => item.type === kind)?.value);
  const year = Number.isInteger(Number(f.year)) && Number(f.year) >= 2000 && Number(f.year) <= 2100 ? Number(f.year) : part('year');
  const quarter = quarters.includes(f.quarter as never) ? f.quarter as 'Q1'|'Q2'|'Q3'|'Q4' : quarters[Math.floor((part('month') - 1) / 3)];
  const currencyCode = currencies.some(c => c.code === f.currencyCode) ? f.currencyCode! : 'USD';
  const userId = actor.role === 'SALES' ? actor.id : users.some(user => user.id === Number(f.userId)) ? Number(f.userId) : users[0]?.id;
  const rep = users.find(user => user.id === userId);
  const metrics = userId ? await forecastForRep(prisma, actor, { userId, year, quarter, currencyCode }) : null;
  const money = (value: string | null) => value === null ? 'No target set' : formatCurrency(Number(value), currencyCode);
  return <Content><PageHeader eyebrow="Reports" title="Quarterly Forecast" description="Current open Opportunities by expected close date. Values are shown in one currency." action={<Link href="/reports" className="btn-secondary">Reports</Link>}/>
    <form method="get" className="panel mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">{actor.role !== 'SALES' && <label className="label">Sales Rep<select className="field" name="userId" defaultValue={userId}>{users.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label>}<label className="label">Year<input className="field" name="year" type="number" min="2000" max="2100" defaultValue={year}/></label><label className="label">Quarter<select className="field" name="quarter" defaultValue={quarter}>{quarters.map(q => <option key={q}>{q}</option>)}</select></label><label className="label">Currency<select className="field" name="currencyCode" defaultValue={currencyCode}>{currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></label><div className="self-end"><button className="btn-primary">View forecast</button></div></form>
    {metrics ? <><p className="mb-4 text-sm text-slate-600">{rep?.firstName} {rep?.lastName} · {metrics.periodStart} through {metrics.periodEnd} · {currencyCode} · {metrics.opportunityCount} open Opportunities</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Quarterly Target',money(metrics.target)],['Pipeline',money(metrics.pipeline)],['Weighted Pipeline',money(metrics.weightedPipeline)],['Commit',money(metrics.commit)],['Best Case',money(metrics.bestCase)],['Pipeline Coverage',metrics.pipelineCoverage ? `${metrics.pipelineCoverage}x` : '—'],['Weighted Coverage',metrics.weightedCoverage ? `${metrics.weightedCoverage}x` : '—'],['Commit Coverage',metrics.commitCoverage ? `${metrics.commitCoverage}x` : '—']].map(([label,value]) => <div className="panel p-5" key={label}><div className="label">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>)}</div>{metrics.targetStatus !== 'SET' && <p className="mt-4 text-sm text-slate-600">{metrics.targetStatus === 'NO_TARGET' ? 'No target set' : 'Target is zero'}; coverage is unavailable.</p>}</> : <div className="panel p-5">No sales rep is available.</div>}
  </Content>;
}
