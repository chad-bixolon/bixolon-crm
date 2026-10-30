'use client';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BULK_SELECTION_LIMIT } from '@/lib/bulk-action-contract';

export function TradeShowBulkRoutingForm({ action, children }: { action: (form: FormData) => Promise<unknown>; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), gate = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const [review, setReview] = useState<FormData | null>(null), [summary, setSummary] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [partnerReview, setPartnerReview] = useState<{partner:string;owner:string} | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  const close = () => { if (!gate.current) { dialog.current?.close(); setReview(null); trigger.current?.focus(); } };
  return <>{message && <p role="status" className="p-3 text-sm text-emerald-800">{message}</p>}<form aria-label="Route event leads" onSubmit={event => {
    event.preventDefault();
    if (busy || gate.current) return;
    const data = new FormData(event.currentTarget), ids = data.getAll('leadIds');
    if (!ids.length || ids.length > BULK_SELECTION_LIMIT) { setError(`Select between 1 and ${BULK_SELECTION_LIMIT} leads on this page.`); return; }
    const routing = event.currentTarget.querySelector<HTMLSelectElement>('[name="bulkRouting"]');
    const rep = event.currentTarget.querySelector<HTMLSelectElement>('[name="bulkRepId"]');
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(''); setPartnerReview(null);
    const summary = `Route ${ids.length} selected lead${ids.length === 1 ? '' : 's'} to ${routing?.selectedOptions[0]?.text}${rep?.value ? ` · ${rep.selectedOptions[0]?.text}` : ''}.`;
    startTransition(async () => {
      if (data.get('bulkRouting') === 'REFERRED_TO_PARTNER') {
        data.set('preview', 'true');
        try {
          const result = await action(data) as {error?:string;preview?:{token:string;partner:string;owner:string}};
          if (result.error || !result.preview) { setError(result.error ?? 'Review the routing again.'); return; }
          data.delete('preview'); data.set('routingIntentToken', result.preview.token);
          setPartnerReview(result.preview);
        } catch { setError('Routing could not be reviewed. Refresh the list and try again.'); return; }
      }
      setReview(data); setSummary(summary); dialog.current?.showModal();
    });
  }}><fieldset disabled={busy} className="min-w-0">{children}</fieldset>{error && !review && <p role="alert" className="p-3 text-sm text-red-700">{error}</p>}</form>
    <dialog ref={dialog} className="bulk-confirm-dialog saved-views-dialog" aria-label={partnerReview ? 'Confirm Partner Routing' : 'Confirm bulk routing'} onCancel={event => { event.preventDefault(); close(); }}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault(); if (!review || gate.current) return;
        gate.current = true; review.set('confirmed', 'true'); setError('');
        startTransition(async () => {
          try {
            const result = await action(review) as { error?: string; success?: string };
            if (result?.error) setError(result.error);
            else { setMessage(result?.success ?? 'Leads routed successfully.'); dialog.current?.close(); setReview(null); router.refresh(); }
          } catch { setError('The result could not be confirmed. Refresh the list before retrying.'); }
          finally { gate.current = false; }
        });
      }}><h2 className="text-lg font-semibold">{partnerReview ? 'Confirm Partner Routing' : 'Confirm bulk routing'}</h2>
        {partnerReview ? <><dl className="space-y-2 text-sm"><div><dt className="label">Partner</dt><dd>{partnerReview.partner}</dd></div><div><dt className="label">Follow-up Owner</dt><dd>{partnerReview.owner}</dd></div><div><dt className="label">Leads</dt><dd>{review?.getAll('leadIds').length}</dd></div></dl><p className="break-words text-sm">These leads will be assigned to {partnerReview.partner} and added to the Partner Handoff queue. {partnerReview.owner} will receive one internal follow-up Task after the handoff is completed.</p></> : <p className="break-words text-sm">{summary}</p>}
        <p className="text-sm text-slate-600">{!partnerReview && 'Routing may create, reassign or cancel the follow-up Task. '}If any selected lead changed while you were reviewing it, no leads will be updated.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="form-action-row"><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Routing…' : 'Confirm routing'}</button></div></form>
    </dialog></>;
}
