import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SalesQuarter, type ForecastCategory } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { can, opportunityScope } from '@/lib/authorization';
import { formatCurrency } from '@/lib/display-format';
import { quarterBounds } from '@/lib/forecast';
import { closeDateMovement, snapshotChange, snapshotComparisonState } from '@/lib/opportunity-history';
export const dynamic = 'force-dynamic';
type Filters = { year?: string; quarter?: string; currencyCode?: string; repId?: string; stageId?: string; category?: string; from?: string; to?: string; includeArchived?: string };
export default async function ForecastMovement({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await currentUser(); if (!can(actor, 'sales.read')) notFound();
  const f = await searchParams;
  const includeArchived = f.includeArchived === '1';
  const now = new Date(), year = Number(f.year) >= 2000 && Number(f.year) <= 2100 ? Number(f.year) : now.getUTCFullYear();
  const quarter = Object.values(SalesQuarter).includes(f.quarter as SalesQuarter) ? f.quarter as SalesQuarter : `Q${Math.floor(now.getUTCMonth()/3)+1}` as SalesQuarter;
  const bounds = quarterBounds(year, quarter);
  const currencyCode = /^[A-Z]{3}$/.test(f.currencyCode ?? '') ? f.currencyCode! : 'USD';
  const requestedRep = Number(f.repId), repId = actor.role === 'SALES' ? actor.id : Number.isSafeInteger(requestedRep) && requestedRep > 0 ? requestedRep : null;
  const [reps, stages, activeSnapshots, archivedSnapshots] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ['SALES','SALES_MANAGER'] } }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    prisma.salesStage.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.forecastSnapshot.findMany({ where: { year, quarter, currencyCode, ...(repId ? { repId } : actor.role === 'SALES' ? { repId: actor.id } : {}) }, orderBy: [{ snapshotWeek: 'desc' }, { id: 'desc' }], take: 200 }),
    includeArchived ? prisma.forecastSnapshotArchive.findMany({ where: { year, quarter, currencyCode, ...(repId ? { repId } : actor.role === 'SALES' ? { repId: actor.id } : {}) }, orderBy: [{ snapshotWeek: 'desc' }, { sourceId: 'desc' }], take: 200 }) : Promise.resolve([]),
  ]);
  const snapshots = [...activeSnapshots, ...archivedSnapshots];
  const weeks = [...new Set(snapshots.map(row => row.snapshotWeek.toISOString().slice(0,10)))].sort().reverse();
  const comparisonState = snapshotComparisonState(weeks);
  const currentWeek = f.to && weeks.includes(f.to) ? f.to : weeks[0], previousWeek = f.from && weeks.includes(f.from) ? f.from : weeks[1];
  const canCompare = comparisonState === 'READY' && !!currentWeek && !!previousWeek && currentWeek !== previousWeek;
  const fromDate = canCompare ? new Date(`${previousWeek}T00:00:00Z`) : null, toDate = canCompare ? new Date(new Date(`${currentWeek}T00:00:00Z`).getTime()+7*86400000) : null;
  const stageId = Number(f.stageId), category = ['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].includes(f.category ?? '') ? f.category as ForecastCategory : null;
  const eventFilter = { ...opportunityScope(actor), ...(repId ? { ownerId: repId } : {}), ...(Number.isSafeInteger(stageId) && stageId > 0 ? { stageId } : {}) };
  const periodFilter = { occurredAt: { gte: fromDate!, lt: toDate! }, eventType: { in: ['BASELINE', 'STAGE', 'FORECAST_CATEGORY', 'EXPECTED_CLOSE_DATE', 'OWNER', 'PROBABILITY', 'VALUE', 'CURRENCY', 'ARCHIVED', 'REOPENED'] }, ...(category ? { OR: [{ oldCategory: category }, { newCategory: category }] } : {}) };
  const [activeEvents, archiveCandidates] = fromDate && toDate ? await Promise.all([
    prisma.opportunityHistoryEvent.findMany({ where: { opportunity: { is: eventFilter }, ...periodFilter }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100 }),
    includeArchived ? prisma.opportunityHistoryArchive.findMany({ where: periodFilter, orderBy: [{ occurredAt: 'desc' }, { sourceId: 'desc' }], take: 100 }) : Promise.resolve([]),
  ]) : [[], []];
  const visibleArchivedIds = archiveCandidates.length ? new Set((await prisma.opportunity.findMany({ where: { id: { in: archiveCandidates.map(event => event.opportunityId) }, ...eventFilter }, select: { id: true } })).map(row=>row.id)) : new Set<number>();
  const events = [...activeEvents, ...archiveCandidates.filter(event => visibleArchivedIds.has(event.opportunityId))].sort((a,b)=>b.occurredAt.getTime()-a.occurredAt.getTime()).slice(0,100);
  const money = (n: number) => formatCurrency(n, currencyCode);
  const inQuarter = (date: Date | null) => !!date && date >= bounds.start && date < bounds.endExclusive;
  const eventDetail = (event: typeof events[number]) => {
    if (event.eventType === 'FORECAST_CATEGORY') return `${event.oldCategory ?? '—'} → ${event.newCategory ?? '—'}`;
    if (event.eventType === 'STAGE') return `${event.oldStageName ?? '—'} → ${event.newStageName ?? '—'}`;
    if (event.eventType === 'EXPECTED_CLOSE_DATE') {
      const movement = inQuarter(event.oldCloseDate) !== inQuarter(event.newCloseDate) ? inQuarter(event.newCloseDate) ? 'Entered selected quarter' : 'Left selected quarter' : closeDateMovement(event.oldCloseDate,event.newCloseDate);
      return `${event.oldCloseDate?.toISOString().slice(0,10) ?? '—'} → ${event.newCloseDate?.toISOString().slice(0,10) ?? '—'} (${movement})`;
    }
    if (event.eventType === 'VALUE') return `${money(Number(event.oldValue ?? 0))} → ${money(Number(event.newValue ?? 0))}`;
    if (event.eventType === 'BASELINE') return 'Initial captured state';
    return '';
  };
  return <Content><PageHeader eyebrow="Reports" title="Forecast Movement" description="Compare captured weekly forecast states. Opportunity events show recorded changes during the interval, not a reconciliation of the total." action={<Link className="btn-secondary" href="/reports/forecast">Current forecast</Link>}/>
    <form className="panel filter-panel filter-grid filter-row mb-5" method="get"><label className="label">Year<input className="field" name="year" type="number" defaultValue={year}/></label><label className="label">Quarter<select className="field" name="quarter" defaultValue={quarter}>{Object.values(SalesQuarter).map(q=><option key={q}>{q}</option>)}</select></label><label className="label">Currency<input className="field" name="currencyCode" maxLength={3} defaultValue={currencyCode}/></label>{actor.role !== 'SALES'&&<label className="label">Rep<select className="field" name="repId" defaultValue={repId ?? ''}><option value="">All reps</option>{reps.map(rep=><option value={rep.id} key={rep.id}>{rep.firstName} {rep.lastName}</option>)}</select></label>}<label className="label">Previous week<select className="field" name="from" defaultValue={previousWeek ?? ''}>{weeks.map(week=><option key={week}>{week}</option>)}</select></label><label className="label">Current week<select className="field" name="to" defaultValue={currentWeek ?? ''}>{weeks.map(week=><option key={week}>{week}</option>)}</select></label><label className="label">Stage<select className="field" name="stageId" defaultValue={f.stageId ?? ''}><option value="">Any</option>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="label">Category movement<select className="field" name="category" defaultValue={category ?? ''}><option value="">Any</option>{['PIPELINE','BEST_CASE','COMMIT','OMITTED','CLOSED'].map(value=><option key={value}>{value}</option>)}</select></label><label className="self-end text-sm"><input className="mr-2" type="checkbox" name="includeArchived" value="1" defaultChecked={includeArchived}/>Include archived history</label><button className="btn-primary">Compare</button></form>
    {canCompare ? <section className="panel mb-5 overflow-x-auto"><h2 className="p-4 font-semibold">{previousWeek} → {currentWeek}</h2><table className="w-full min-w-[600px] text-sm"><thead><tr>{['Measure','Previous','Current','Change','Change %'].map(label=><th className="p-3 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{([['pipeline','Pipeline'],['weightedPipeline','Weighted Pipeline'],['bestCase','Best Case'],['commit','Commit'],['target','Target']] as const).map(([key,label])=>{const movement=snapshotChange(snapshots,previousWeek!,currentWeek!,key); return <tr className="border-t" key={key}><td className="p-3">{label}</td><td className="p-3">{money(Number(movement.previous))}</td><td className="p-3">{money(Number(movement.current))}</td><td className="p-3">{money(Number(movement.change))}</td><td className="p-3">{movement.percent ? `${movement.percent.toFixed(1)}%` : '—'}</td></tr>})}</tbody></table></section> : <p className="panel mb-5 p-5">{comparisonState === 'NONE' ? `No weekly forecast snapshots exist for this selection${includeArchived ? '' : ' in active storage'}. An Admin must capture the first week before movement can be compared. ${includeArchived ? '' : 'Select Include archived history for older weeks.'}` : comparisonState === 'ONE' ? `Only the week of ${weeks[0]} has a snapshot for this selection. Capture a later week to compare movement.` : 'Choose two different snapshot weeks to compare movement.'}</p>}
    <section className="panel p-5"><h2 className="font-semibold">Recorded Opportunity changes</h2><p className="my-2 text-sm text-slate-600">Showing up to 100 recent events. Stage and category filters apply to the event explanation only; aggregate snapshots remain the authoritative forecast totals.</p><ul className="divide-y">{events.map(event=><li className="py-2 text-sm" key={`${'sourceId' in event ? 'a' : 'e'}-${event.id}`}><Link className="text-orange-800 underline" href={`/opportunities/${event.opportunityId}`}>{event.opportunityName}</Link> · {event.eventType.replaceAll('_',' ')} · {event.occurredAt.toISOString().slice(0,16).replace('T',' ')} · {event.actorName ?? 'System'}{eventDetail(event)&&` · ${eventDetail(event)}`}</li>)}</ul>{!events.length&&<p className="text-sm text-slate-500">No recorded changes in this interval.</p>}</section>
  </Content>;
}
