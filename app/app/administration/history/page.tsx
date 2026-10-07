import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { formatCalendarDate, formatEasternDate, formatEasternDateTime } from '@/lib/display-format';
import { captureFeedback, countLabel, existingCaptureFeedback, formatSnapshotWeekQuery } from '@/lib/history-admin-display';
import { newYorkWeek, previewHistoryArchive } from '@/lib/opportunity-history';
import { prisma } from '@/lib/prisma';
import { archiveHistoryAction, captureSnapshotAction, restoreHistoryAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function HistoryAdministration({ searchParams }: { searchParams: Promise<{ capture?: string; count?: string; week?: string; restore?: string }> }) {
  const actor = await currentUser(); if (actor.role !== 'ADMIN') notFound();
  const feedback = await searchParams;
  const preview = await previewHistoryArchive(prisma, actor);
  const [currencies, recentActive, recentArchived, archivedEvents, archivedSnapshots] = await Promise.all([
    prisma.currency.findMany({ where: { active: true }, select: { code: true }, orderBy: { code: 'asc' } }),
    prisma.forecastSnapshot.findMany({ orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }], take: 20, select: { repName: true, snapshotWeek: true, capturedAt: true, year: true, quarter: true, currencyCode: true } }),
    prisma.forecastSnapshotArchive.findMany({ orderBy: [{ capturedAt: 'desc' }, { sourceId: 'desc' }], take: 20, select: { sourceId: true, repName: true, snapshotWeek: true, capturedAt: true, year: true, quarter: true, currencyCode: true } }),
    prisma.opportunityHistoryArchive.findMany({ distinct: ['archiveBatchId'], orderBy: { archivedAt: 'desc' }, take: 20, select: { archiveBatchId: true, archivedAt: true } }),
    prisma.forecastSnapshotArchive.findMany({ distinct: ['archiveBatchId'], orderBy: { archivedAt: 'desc' }, take: 20, select: { archiveBatchId: true, archivedAt: true } }),
  ]);
  const latestSnapshots = [...recentActive, ...recentArchived].sort((a,b)=>b.capturedAt.getTime()-a.capturedAt.getTime()).slice(0,20);
  const batches = [...new Map([...archivedEvents, ...archivedSnapshots].map(row => [row.archiveBatchId, row])).values()].sort((a,b)=>b.archivedAt.getTime()-a.archivedAt.getTime()).slice(0,20);
  const batchIds = batches.map(batch => batch.archiveBatchId);
  const [eventTotals, snapshotTotals] = batchIds.length ? await Promise.all([
    prisma.opportunityHistoryArchive.groupBy({ by: ['archiveBatchId'], where: { archiveBatchId: { in: batchIds } }, _count: { _all: true }, _min: { occurredAt: true }, _max: { occurredAt: true } }),
    prisma.forecastSnapshotArchive.groupBy({ by: ['archiveBatchId'], where: { archiveBatchId: { in: batchIds } }, _count: { _all: true }, _min: { capturedAt: true }, _max: { capturedAt: true } }),
  ]) : [[], []];
  const eventsByBatch = new Map(eventTotals.map(row => [row.archiveBatchId, row]));
  const snapshotsByBatch = new Map(snapshotTotals.map(row => [row.archiveBatchId, row]));
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const snapshotWeek = newYorkWeek(now);
  const currentWeek = formatCalendarDate(snapshotWeek);
  const forecastYear = value('year');
  const forecastQuarter = `Q${Math.floor((value('month')-1)/3)+1}` as SalesQuarter;
  const forecastCurrency = currencies.some(currency => currency.code === 'USD') ? 'USD' : currencies[0]?.code;
  const currentSnapshots = forecastCurrency ? await prisma.forecastSnapshot.aggregate({
    where: { snapshotWeek, year: forecastYear, quarter: forecastQuarter, currencyCode: forecastCurrency },
    _count: { _all: true }, _max: { capturedAt: true },
  }) : null;
  const capturedWeek = formatSnapshotWeekQuery(feedback.week);
  const createdCount = Number(feedback.count);
  const eligible = preview.events > 0 || preview.snapshots > 0;
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="Opportunity & Forecast History" action={<Link className="btn-secondary" href="/administration/settings">Retention setting</Link>}/>
    {feedback.capture === 'created' && capturedWeek && Number.isSafeInteger(createdCount) && createdCount > 0 && <p className="panel mb-4 p-4 text-sm">{captureFeedback(createdCount, capturedWeek)}</p>}
    {feedback.capture === 'existing' && capturedWeek && <p className="panel mb-4 p-4 text-sm">{existingCaptureFeedback(capturedWeek)}</p>}
    {feedback.restore === 'complete' && <p className="panel mb-4 p-4 text-sm">Archive batch restored.</p>}
    <section className="panel mb-4 p-4 sm:p-5" aria-labelledby="snapshot-status-heading">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="snapshot-status-heading" className="text-lg font-semibold">Forecast Snapshot Status</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentSnapshots?._count._all ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{currentSnapshots?._count._all ? 'Active' : 'Not captured'}</span></div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Current week</dt><dd className="text-right font-medium">{currentWeek}</dd></div>
        <div className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Last captured</dt><dd className="text-right font-medium">{currentSnapshots?._max.capturedAt ? formatEasternDateTime(currentSnapshots._max.capturedAt) : 'Not captured yet'}</dd></div>
        <div className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Rep snapshots</dt><dd className="text-right font-medium tabular-nums">{currentSnapshots?._count._all ?? 0}</dd></div>
        <div className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Forecast period</dt><dd className="text-right font-medium">{forecastYear} {forecastQuarter}</dd></div>
        <div className="flex min-w-0 justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Currency</dt><dd className="text-right font-medium">{forecastCurrency ?? '—'}</dd></div>
      </dl>
      <form action={captureSnapshotAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <div className="w-24"><label className="label" htmlFor="snapshot-year">Year</label><input className="field" id="snapshot-year" type="number" name="year" min="2000" max="2100" defaultValue={forecastYear}/></div>
        <div className="w-28"><label className="label" htmlFor="snapshot-quarter">Quarter</label><select className="field" id="snapshot-quarter" name="quarter" defaultValue={forecastQuarter}>{Object.values(SalesQuarter).map(q=><option key={q}>{q}</option>)}</select></div>
        <div className="w-28"><label className="label" htmlFor="snapshot-currency">Currency</label><select className="field" id="snapshot-currency" name="currencyCode" defaultValue={forecastCurrency}>{currencies.map(currency=><option key={currency.code}>{currency.code}</option>)}</select></div>
        <button className="btn-primary self-end">Capture snapshot</button>
      </form>
      <p className="mt-2 text-xs text-slate-600">Captures one snapshot per active rep for the selected period and currency. Repeating a New York calendar week preserves the first snapshot.</p>
    </section>
    <section className="panel mb-4 min-w-0 p-4 sm:p-5" aria-labelledby="recent-snapshots-heading">
      <h2 id="recent-snapshots-heading" className="text-lg font-semibold">Recent Snapshots <span className="text-sm font-normal text-slate-500">({latestSnapshots.length})</span></h2>
      {latestSnapshots.length ? <div className="mt-2 max-w-full overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{['Week of','Rep','Forecast period','Currency','Captured','Status'].map(label=><th className="whitespace-nowrap p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{latestSnapshots.map((row,index)=><tr className="border-t" key={`${row.repName}-${row.snapshotWeek.toISOString()}-${index}`}><td className="whitespace-nowrap p-2">{formatCalendarDate(row.snapshotWeek)}</td><td className="p-2">{row.repName}</td><td className="whitespace-nowrap p-2">{row.year} {row.quarter}</td><td className="p-2">{row.currencyCode}</td><td className="whitespace-nowrap p-2">{formatEasternDateTime(row.capturedAt)}</td><td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${'sourceId' in row ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800'}`}>{'sourceId' in row ? 'Archived' : 'Active'}</span></td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-600">No weekly forecast snapshots have been captured yet.</p>}
    </section>
    <section className="panel mb-4 p-4 sm:p-5" aria-labelledby="archive-status-heading">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="archive-status-heading" className="text-lg font-semibold">Archive Status</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${eligible ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{eligible ? 'Eligible for archive' : 'Nothing eligible'}</span></div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Active history retention</dt><dd className="font-medium">{preview.years} {preview.years === 1 ? 'year' : 'years'}</dd></div>
        <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Archive cutoff</dt><dd className="font-medium">{formatCalendarDate(preview.cutoff)}</dd></div>
        <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Eligible Opportunity events</dt><dd className="font-medium tabular-nums">{preview.events}</dd></div>
        <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-600">Eligible forecast snapshots</dt><dd className="font-medium tabular-nums">{preview.snapshots}</dd></div>
      </dl>
      {eligible ? <form action={archiveHistoryAction} className="mt-4"><input type="hidden" name="cutoff" value={preview.cutoff.toISOString()}/><input type="hidden" name="events" value={preview.events}/><input type="hidden" name="snapshots" value={preview.snapshots}/><button className="btn-secondary">Archive next 500 of each</button></form> : <p className="mt-3 text-sm text-slate-600">No history is currently eligible for archive.</p>}
    </section>
    <section className="panel p-4 sm:p-5" aria-labelledby="restore-history-heading">
      <h2 id="restore-history-heading" className="text-lg font-semibold">Restore History</h2>
      {batches.length ? <ul className="divide-y">{batches.map(batch => {
        const events = eventsByBatch.get(batch.archiveBatchId), snapshots = snapshotsByBatch.get(batch.archiveBatchId);
        return <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" key={batch.archiveBatchId}>
          <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Archived {formatEasternDateTime(batch.archivedAt)}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Archived</span></div><p className="text-slate-600">{countLabel(events?._count._all ?? 0, 'Opportunity event', 'Opportunity events')} · {countLabel(snapshots?._count._all ?? 0, 'forecast snapshot', 'forecast snapshots')}</p>
            {events?._min.occurredAt && events._max.occurredAt && <p className="text-slate-600">Opportunity events: {formatEasternDate(events._min.occurredAt)} – {formatEasternDate(events._max.occurredAt)}</p>}
            {snapshots?._min.capturedAt && snapshots._max.capturedAt && <p className="text-slate-600">Forecast snapshots: {formatEasternDate(snapshots._min.capturedAt)} – {formatEasternDate(snapshots._max.capturedAt)}</p>}
          </div>
          <form action={restoreHistoryAction}><input type="hidden" name="batchId" value={batch.archiveBatchId}/><button className="btn-secondary">Restore</button></form>
        </li>;
      })}</ul> : <p className="mt-2 text-sm text-slate-600">No archived history batches are available to restore.</p>}
    </section>
  </Content>;
}
