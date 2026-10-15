'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { SalesQuarter } from '@prisma/client';
import { previewForecastAction, confirmForecastAction } from './actions';
import { formatPlanCurrency as formatCurrency } from '@/lib/display-format';
type Preview = NonNullable<Awaited<ReturnType<typeof previewForecastAction>>['preview']>;
export function ForecastSnapshotWorkflow({ sources, initialPeriod }: { sources: { id: number; snapshotAt: string; opportunityCount: number }[]; initialPeriod: { year: number; quarter: SalesQuarter } }) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const clear = () => { setPreview(null); setConfirmed(false); setFeedback(null); };
  return <section className="panel mb-5 p-5" aria-labelledby="forecast-capture-title"><h2 id="forecast-capture-title" className="text-lg font-semibold">Manual Forecast Snapshot</h2>
    <form className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" onChange={clear} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); clear();
      startTransition(async () => {
        try { const result = await previewForecastAction({ sourceRunId: Number(data.get('sourceRunId')), year: Number(data.get('year')), quarter: data.get('quarter') as SalesQuarter }); if (result.preview) setPreview(result.preview); else setFeedback({ error: result.error }); }
        catch { setFeedback({ error: 'Could not preview the Forecast Snapshot. Try again.' }); }
      });
    }}>
      <label className="min-w-0 text-sm sm:col-span-2">Source Opportunity Snapshot Run<select className="field mt-1 w-full" required name="sourceRunId" aria-label="Source Opportunity Snapshot Run" disabled={pending}><option value="">Choose a forecast-ready run</option>{sources.map(source => <option value={source.id} key={source.id}>#{source.id} · {source.snapshotAt} · {source.opportunityCount} deals</option>)}</select></label>
      <label className="text-sm">Forecast year<input className="field mt-1" type="number" min="2000" max="2100" name="year" defaultValue={initialPeriod.year} required disabled={pending}/></label>
      <label className="text-sm">Forecast quarter<select className="field mt-1" name="quarter" aria-label="Forecast quarter" defaultValue={initialPeriod.quarter} disabled={pending}>{['Q1', 'Q2', 'Q3', 'Q4'].map(q => <option key={q}>{q}</option>)}</select></label>
      <div><button className="btn-secondary" disabled={pending || !sources.length}>{pending ? 'Working…' : 'Preview Forecast Snapshot'}</button></div>
    </form>
    {!sources.length && <p className="mt-4 text-sm">No compatible source runs. <Link className="underline" href="/administration/opportunity-snapshots">Create an Opportunity Snapshot</Link> with forecast-ready scope first. An existing open-only run cannot be upgraded or replaced.</p>}
    {preview && <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); if (!confirmed || pending) return; startTransition(async () => {
      try { const result = await confirmForecastAction(preview.token, confirmed); setFeedback(result); setPreview(null); setConfirmed(false); }
      catch { setFeedback({ error: 'Could not confirm. Preview again to check whether the run completed.' }); setPreview(null); setConfirmed(false); }
    }); }}>
      <div className="grid gap-3 text-sm sm:grid-cols-2"><p>Source Opportunity Snapshot Run <strong>#{preview.sourceRunId}</strong><span className="block break-words">{preview.snapshotAt}</span></p><p>Forecast period: <strong>{preview.year} {preview.quarter}</strong><span className="block">{preview.opportunityCount} included Opportunities · {preview.salespersonCount} salespeople</span></p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{['Currency', 'Commit', 'Best Case', 'Pipeline (all open)', 'Closed Won', 'Opportunities'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{preview.totals.map(total => <tr key={total.currencyCode}><td className="p-2">{total.currencyCode}</td>{(['commit', 'bestCase', 'pipeline', 'closedWon'] as const).map(key => <td className="p-2" key={key}>{formatCurrency(total[key], total.currencyCode)}</td>)}<td className="p-2">{Number(total.opportunityCount)}</td></tr>)}</tbody></table></div>
      {!preview.totals.length && <p className="text-sm">No eligible Opportunities in this period. This creates a valid empty historical run.</p>}
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I confirm this immutable Forecast Snapshot from source run #{preview.sourceRunId} for {preview.year} {preview.quarter}.</label>
      <button className="btn-primary" disabled={pending || !confirmed}>Confirm Forecast Snapshot</button>
    </form>}
    {feedback?.error && <p role="alert" className="mt-4 text-sm text-red-700">{feedback.error}</p>}
    {feedback?.success && <p role="status" className="mt-4 text-sm text-emerald-800">{feedback.success} <Link className="underline" href="/reports/forecast-snapshots">View forecast history</Link></p>}
  </section>;
}
