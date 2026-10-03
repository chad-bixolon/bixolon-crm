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
  const currentWeek = formatCalendarDate(newYorkWeek(now));
  const capturedWeek = formatSnapshotWeekQuery(feedback.week);
  const createdCount = Number(feedback.count);
  const eligible = preview.events > 0 || preview.snapshots > 0;
  return <Content><PageHeader eyebrow="Administration" title="Opportunity & Forecast History" action={<Link className="btn-secondary" href="/administration/settings">Retention setting</Link>}/>
    {feedback.capture === 'created' && capturedWeek && Number.isSafeInteger(createdCount) && createdCount > 0 && <p className="panel mb-4 p-4 text-sm">{captureFeedback(createdCount, capturedWeek)}</p>}
    {feedback.capture === 'existing' && capturedWeek && <p className="panel mb-4 p-4 text-sm">{existingCaptureFeedback(capturedWeek)}</p>}
    {feedback.restore === 'complete' && <p className="panel mb-4 p-4 text-sm">Archive batch restored.</p>}
    <section className="panel mb-5 p-5">
      <h2 className="text-lg font-semibold">Capture weekly forecast</h2>
      <p className="mt-2 text-sm font-medium">Current snapshot week: {currentWeek}</p>
      <p className="my-2 text-sm text-slate-600">Captures one snapshot per active rep for the selected year, quarter, and currency, using New York calendar weeks. Capturing the same week again preserves the first snapshot.</p>
      <form action={captureSnapshotAction} className="flex flex-wrap items-end gap-3"><label className="label">Year<input className="field" type="number" name="year" min="2000" max="2100" defaultValue={value('year')}/></label><label className="label">Quarter<select className="field" name="quarter" defaultValue={`Q${Math.floor((value('month')-1)/3)+1}`}>{Object.values(SalesQuarter).map(q=><option key={q}>{q}</option>)}</select></label><label className="label">Currency<select className="field" name="currencyCode" defaultValue="USD">{currencies.map(currency=><option key={currency.code}>{currency.code}</option>)}</select></label><button className="btn-primary">Capture snapshot</button></form>
      <h3 className="mt-5 font-semibold">Recent snapshots</h3>
      {latestSnapshots.length ? <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Week of','Rep','Forecast period','Currency','Captured','Status'].map(label=><th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{latestSnapshots.map((row,index)=><tr className="border-t" key={`${row.repName}-${row.snapshotWeek.toISOString()}-${index}`}><td className="p-2">{formatCalendarDate(row.snapshotWeek)}</td><td className="p-2">{row.repName}</td><td className="p-2">{row.year} {row.quarter}</td><td className="p-2">{row.currencyCode}</td><td className="p-2">{formatEasternDateTime(row.capturedAt)}</td><td className="p-2">{'sourceId' in row ? 'Archived' : 'Active'}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-600">No weekly forecast snapshots have been captured yet.</p>}
    </section>
    <section className="panel p-5">
      <h2 className="text-lg font-semibold">Archive preview</h2>
      <p className="mt-2 text-sm text-slate-600">Active history retention: {preview.years} {preview.years === 1 ? 'year' : 'years'}</p>
      <p className="my-2 text-sm">History older than {preview.years} {preview.years === 1 ? 'year' : 'years'} is eligible for archive. Cutoff: {formatCalendarDate(preview.cutoff)}.</p>
      {eligible ? <p className="text-sm">{countLabel(preview.events, 'Opportunity event', 'Opportunity events')} and {countLabel(preview.snapshots, 'forecast snapshot', 'forecast snapshots')} are eligible for archive.</p> : <p className="text-sm">No history is currently eligible for archive.</p>}
      {eligible && <form action={archiveHistoryAction} className="mt-4"><input type="hidden" name="cutoff" value={preview.cutoff.toISOString()}/><input type="hidden" name="events" value={preview.events}/><input type="hidden" name="snapshots" value={preview.snapshots}/><button className="btn-secondary">Archive next 500 of each</button></form>}
    </section>
    <section className="panel mt-5 p-5">
      <h2 className="text-lg font-semibold">Restore an archive batch</h2>
      <p className="my-2 text-sm text-slate-600">Restores original IDs and values in one transaction. A conflict leaves the whole batch archived.</p>
      {batches.length ? <ul className="divide-y">{batches.map(batch => {
        const events = eventsByBatch.get(batch.archiveBatchId), snapshots = snapshotsByBatch.get(batch.archiveBatchId);
        return <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" key={batch.archiveBatchId}>
          <div><p className="font-medium">Archived {formatEasternDateTime(batch.archivedAt)}</p><p className="text-slate-600">{countLabel(events?._count._all ?? 0, 'Opportunity event', 'Opportunity events')} · {countLabel(snapshots?._count._all ?? 0, 'forecast snapshot', 'forecast snapshots')} · Status: Archived</p>
            {events?._min.occurredAt && events._max.occurredAt && <p className="text-slate-600">Opportunity events: {formatEasternDate(events._min.occurredAt)} – {formatEasternDate(events._max.occurredAt)}</p>}
            {snapshots?._min.capturedAt && snapshots._max.capturedAt && <p className="text-slate-600">Forecast snapshots: {formatEasternDate(snapshots._min.capturedAt)} – {formatEasternDate(snapshots._max.capturedAt)}</p>}
          </div>
          <form action={restoreHistoryAction}><input type="hidden" name="batchId" value={batch.archiveBatchId}/><button className="btn-secondary">Restore</button></form>
        </li>;
      })}</ul> : <p className="text-sm text-slate-600">No archived history batches are available to restore.</p>}
    </section>
  </Content>;
}
