'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Preview = { partner: string; tradeShow: string; count: number; token: string; businessDays: number };
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
  return <div><button ref={trigger} type="button" className="btn-primary" disabled={busy} onClick={open}>{busy ? 'Preparing…' : batchId ? 'Historical Re-export' : 'Export & Mark Sent'}</button>
    {error && !preview && !historical && <p className="mt-2 text-sm text-red-800" role="alert">{error}</p>}
    <dialog ref={dialog} aria-labelledby="handoff-confirm-title" className="bulk-confirm-dialog saved-views-dialog" onCancel={event => { event.preventDefault(); close(); }}><section className="space-y-3">
      <h2 id="handoff-confirm-title" className="text-lg font-semibold">{historical ? 'Confirm Historical Re-export' : 'Confirm Partner Handoff'}</h2>
      {preview && <><dl className="my-4 space-y-2"><div><dt className="label">Partner</dt><dd>{preview.partner}</dd></div><div><dt className="label">Trade Show</dt><dd>{preview.tradeShow}</dd></div><div><dt className="label">Leads</dt><dd>{preview.count} awaiting leads · Only unsent leads included</dd></div></dl><p className="text-sm">This export marks these leads Sent to Partner and creates one internal follow-up Task, due in {preview.businessDays} business days. Send the file through your normal business channel.</p></>}
      {historical && <p className="my-4 text-sm">Download the original approved handoff snapshot. This is a historical re-export: it creates no Task and does not change lead status. Only send it again if intended.</p>}
      {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn-primary" disabled={busy} onClick={download}>{busy ? 'Exporting…' : historical ? 'Download Historical Export' : 'Confirm Export & Mark Sent'}</button></div>
    </section></dialog>
  </div>;
}
