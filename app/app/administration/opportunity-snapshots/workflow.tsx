'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { confirmSnapshotAction, previewSnapshotAction } from './actions';

type Preview = { preparedAt: string; week: string; count: number; forecastReady?: boolean; token: string };
export function SnapshotWorkflow() {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [forecastReady, setForecastReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string; runId?: number } | null>(null);
  return <section className="panel mb-5 p-5" aria-labelledby="snapshot-capture-title">
    <h2 className="text-lg font-semibold" id="snapshot-capture-title">Manual snapshot capture</h2>
    <p className="my-3 text-sm text-slate-600">One immutable run per Monday–Sunday week in America/New_York. Snapshot time is the actual capture time; backdating and reruns are disabled.</p>
    <label className="mb-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={forecastReady} disabled={pending} onChange={event => { setForecastReady(event.target.checked); setPreview(null); setConfirmed(false); }}/>Forecast-ready scope: include open and Closed Won Opportunities and capture owner eligibility. Required for Forecast Snapshot rollups. Choose before capturing; only one source run is allowed per week.</label>
    <button type="button" className="btn-secondary" disabled={pending} onClick={() => {
      setFeedback(null); setPreview(null); setConfirmed(false);
      startTransition(async () => {
        try { const result = await previewSnapshotAction(forecastReady); if (result.preview) setPreview(result.preview); else setFeedback({ error: result.error }); }
        catch { setFeedback({ error: 'Could not preview the snapshot. Try again.' }); }
      });
    }}>{pending ? 'Working…' : 'Preview snapshot'}</button>
    {preview && <form className="mt-4 space-y-4" onSubmit={event => {
      event.preventDefault(); if (pending || !confirmed) return;
      setFeedback(null);
      startTransition(async () => {
        try {
          const result = await confirmSnapshotAction(preview.token, confirmed);
          setFeedback(result); setPreview(null); setConfirmed(false);
        } catch { setFeedback({ error: 'Could not confirm the snapshot. Preview again to check whether the run completed.' }); setPreview(null); setConfirmed(false); }
      });
    }}>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="label">Preview time (UTC)</dt><dd className="break-words">{preview.preparedAt}</dd></div>
        <div><dt className="label">Week starting</dt><dd>{preview.week}</dd></div>
        <div><dt className="label">Opportunities to capture</dt><dd>{preview.count}</dd></div>
      </dl>
      <p className="text-sm">Scope: {preview.forecastReady ? 'open and Closed Won, with captured owner eligibility' : 'open only'}. The snapshot will capture current values when you confirm. If the previewed data changes, you must preview again.</p>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I confirm creation of this immutable snapshot set of {preview.count} Opportunities.</label>
      <button className="btn-primary" disabled={pending || !confirmed}>Confirm snapshot</button>
    </form>}
    {feedback?.error && <p className="mt-3 text-sm text-red-700" role="alert">{feedback.error}</p>}
    {feedback?.success && <p className="mt-3 text-sm text-emerald-800" role="status">{feedback.success} <Link className="underline" href="/reports/opportunity-snapshots">View snapshot history</Link></p>}
  </section>;
}
