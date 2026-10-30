'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Preview = { partner: string; tradeShow: string; count: number; token: string; businessDays: number; followUpOwner: string };
export function PartnerHandoffExport({ showId, partnerId, batchId }: { showId: number; partnerId?: number; batchId?: number }) {
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [historical, setHistorical] = useState(false);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), gate = useRef(false);
  useEffect(() => { if (preview || historical) dialog.current?.showModal(); else dialog.current?.close(); }, [preview, historical]);
  function close() { if (gate.current) return; setPreview(null); setHistorical(false); setError(''); trigger.current?.focus(); }
  async function request(action: string, token?: string) {
    const response = await fetch(`/trade-shows/${showId}/partner-handoffs/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, partnerId, batchId, token }) });
    if (response.redirected) throw new Error('Trade Shows or your access is unavailable. Refresh the page.');
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Export unavailable.'); }
    return response;
  }
  async function open() {
    setError('');
    if (batchId) { setHistorical(true); return; }
    setBusy(true);
    try { setPreview(await (await request('preview')).json()); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function download() {
    if (gate.current) return; gate.current = true;
    setBusy(true); setError('');
    try {
      const response = await request(batchId ? 'historical' : 'finalize', preview?.token);
      const blob = await response.blob(), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'Partner_Leads.xlsx';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setPreview(null); setHistorical(false);
      if (batchId) router.refresh();
      else router.push(`/trade-shows/${showId}/partner-handoffs/${response.headers.get('x-handoff-batch')}`);
    } catch (e) { setError((e as Error).message); }
    finally { gate.current = false; setBusy(false); }
  }
  return <div><button ref={trigger} type="button" className="btn-primary" disabled={busy} onClick={open}>{busy ? 'Preparing…' : batchId ? 'Re-export Handoff' : 'Export & Complete Handoff'}</button>
    {error && !preview && !historical && <p className="mt-2 text-sm text-red-800" role="alert">{error}</p>}
    <dialog ref={dialog} aria-labelledby="handoff-confirm-title" className="bulk-confirm-dialog saved-views-dialog" onCancel={event => { event.preventDefault(); close(); }}><section className="space-y-3">
      <h2 id="handoff-confirm-title" className="text-lg font-semibold">{historical ? 'Confirm Handoff Re-export' : 'Confirm Partner Handoff'}</h2>
      {preview && <><dl className="my-4 space-y-2"><div><dt className="label">Partner</dt><dd>{preview.partner}</dd></div><div><dt className="label">Trade Show</dt><dd>{preview.tradeShow}</dd></div><div><dt className="label">Follow-up Owner</dt><dd>{preview.followUpOwner}</dd></div><div><dt className="label">Leads</dt><dd>{preview.count}</dd></div></dl><p className="text-sm">This will export {preview.count} {preview.count === 1 ? 'lead' : 'leads'} for {preview.partner}, mark them as Sent to Partner, and create one internal follow-up Task due in {preview.businessDays} business {preview.businessDays === 1 ? 'day' : 'days'}. SalesHub will not email the partner automatically.</p><p className="text-sm text-slate-600">Source Notes, Partner Handoff Notes, Product Interest, Qualification, Competitor Mentioned, Current Product Being Used and Customer Pain Points are shared in this export. Sales Notes and internal Referral Notes stay private.</p></>}
      {historical && <p className="my-4 text-sm">Download the original handoff file with the lead details as they were when the handoff was completed. Re-exporting does not change lead status or create another Task.</p>}
      {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn-primary" disabled={busy} onClick={download}>{busy ? 'Exporting…' : historical ? 'Re-export Handoff' : 'Export & Complete Handoff'}</button></div>
    </section></dialog>
  </div>;
}
