import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SalesQuarter } from '@prisma/client';
import { Content, PageHeader } from '@/components/shell';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { previewHistoryArchive } from '@/lib/opportunity-history';
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
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return <Content><PageHeader eyebrow="Administration" title="Opportunity history" action={<Link className="btn-secondary" href="/administration/settings">Retention setting</Link>}/>
    {feedback.capture === 'created' && <p className="panel mb-4 p-4 text-sm">Captured {Number(feedback.count) || 0} rep snapshot(s) for the week of {feedback.week}.</p>}
    {feedback.capture === 'existing' && <p className="panel mb-4 p-4 text-sm">Snapshots for the week of {feedback.week} already exist for all eligible reps. Existing values were preserved.</p>}
    {feedback.restore === 'complete' && <p className="panel mb-4 p-4 text-sm">Archive batch restored.</p>}
    <section className="panel mb-5 p-5"><h2 className="text-lg font-semibold">Capture weekly forecast</h2><p className="my-2 text-sm text-slate-600">Creates one snapshot per active rep for this New York calendar week and selected quarter. Repeating a capture does not overwrite the first snapshot.</p><form action={captureSnapshotAction} className="flex flex-wrap items-end gap-3"><label className="label">Year<input className="field" type="number" name="year" min="2000" max="2100" defaultValue={value('year')}/></label><label className="label">Quarter<select className="field" name="quarter" defaultValue={`Q${Math.floor((value('month')-1)/3)+1}`}>{Object.values(SalesQuarter).map(q=><option key={q}>{q}</option>)}</select></label><label className="label">Currency<select className="field" name="currencyCode" defaultValue="USD">{currencies.map(currency=><option key={currency.code}>{currency.code}</option>)}</select></label><button className="btn-primary">Capture snapshot</button></form><h3 className="mt-5 font-semibold">Recent snapshots</h3>{latestSnapshots.length ? <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Week of','Rep','Forecast period','Currency','Captured (UTC)','Storage'].map(label=><th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{latestSnapshots.map((row,index)=><tr className="border-t" key={`${row.repName}-${row.snapshotWeek.toISOString()}-${index}`}><td className="p-2">{row.snapshotWeek.toISOString().slice(0,10)}</td><td className="p-2">{row.repName}</td><td className="p-2">{row.year} {row.quarter}</td><td className="p-2">{row.currencyCode}</td><td className="p-2">{row.capturedAt.toISOString().slice(0,16).replace('T',' ')}</td><td className="p-2">{'sourceId' in row ? 'Archived' : 'Active'}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-600">No weekly snapshots captured yet.</p>}</section>
    <section className="panel p-5"><h2 className="text-lg font-semibold">Archive preview</h2><p className="my-2 text-sm">History older than {preview.years} years is eligible for archive. Cutoff: {preview.cutoff.toISOString().slice(0,10)}.</p><p className="text-sm">{preview.events} Opportunity events ({preview.firstEvent?.toISOString().slice(0,10) ?? '—'} to {preview.lastEvent?.toISOString().slice(0,10) ?? '—'}) · {preview.snapshots} forecast snapshots ({preview.firstSnapshot?.toISOString().slice(0,10) ?? '—'} to {preview.lastSnapshot?.toISOString().slice(0,10) ?? '—'}).</p>{(preview.events > 0 || preview.snapshots > 0) && <form action={archiveHistoryAction} className="mt-4"><input type="hidden" name="cutoff" value={preview.cutoff.toISOString()}/><input type="hidden" name="events" value={preview.events}/><input type="hidden" name="snapshots" value={preview.snapshots}/><button className="btn-secondary">Archive next 500 of each</button></form>}</section>
    <section className="panel mt-5 p-5"><h2 className="text-lg font-semibold">Restore an archive batch</h2><p className="my-2 text-sm text-slate-600">Restores original IDs and values in one transaction. A conflict leaves the whole batch archived.</p>{batches.length ? <ul className="divide-y">{batches.map(batch=><li className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm" key={batch.archiveBatchId}><span>{batch.archivedAt.toISOString().slice(0,16).replace('T',' ')} UTC · Batch {batch.archiveBatchId}</span><form action={restoreHistoryAction}><input type="hidden" name="batchId" value={batch.archiveBatchId}/><button className="btn-secondary">Restore batch</button></form></li>)}</ul> : <p className="text-sm text-slate-600">No archived batches.</p>}</section>
  </Content>;
}
