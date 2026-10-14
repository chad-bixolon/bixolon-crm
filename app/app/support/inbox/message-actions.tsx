'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useSubmitGuard } from '@/lib/submit-guard';
import { InboxDisclosure } from './disclosure';
import { ignoreInboxMessage, linkInboxMessage, restoreInboxMessage } from './actions';

type CaseOption = { id: number; caseNumber: string; subject: string };
export function InboxMessageActions({ messageId, suggestedCases, ignored = false, linked = false }: { messageId: string; suggestedCases: CaseOption[]; ignored?: boolean; linked?: boolean }) {
  const [caseId, setCaseId] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [linkState, linkAction, linking] = useActionState(linkInboxMessage, {});
  const linkGuard = useSubmitGuard(linkState, linkAction);
  const [ignoreState, ignoreAction, ignoring] = useActionState(ignoreInboxMessage, {});
  const [restoreState, restoreAction, restoring] = useActionState(restoreInboxMessage, {});
  if (ignored) return <form action={restoreAction} className="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="messageId" value={messageId}/><button className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50" disabled={restoring} type="submit">{restoring ? 'Restoring…' : 'Restore to inbox'}</button>{restoreState.message && <p role="alert" className="text-sm text-red-700">{restoreState.message}</p>}</form>;
  return <div className="mt-3 flex flex-wrap items-start gap-2" aria-label="Message actions">
    <Link className="btn-primary" href={`/support/cases/new?emailMessageId=${encodeURIComponent(messageId)}`}>Create Case</Link>
    <InboxDisclosure label="Link to Case" buttonClassName="btn-secondary" className="contents" panelClassName="order-last w-full">
      <form onSubmit={linkGuard} className="mt-2 flex min-w-0 flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <input type="hidden" name="messageId" value={messageId}/>
        <label className="min-w-0 flex-[1_1_14rem] text-sm">Suggested case<select name="caseId" className="field mt-1 w-full min-w-0 max-w-full" value={caseId} onChange={event => setCaseId(event.target.value)}><option value="">Choose case</option>{suggestedCases.map(row => <option key={row.id} value={row.id}>{row.caseNumber} · {row.subject}</option>)}</select></label>
        <label className="min-w-0 flex-[1_1_12rem] text-sm">Or exact case number<input name="caseNumber" className="field mt-1 w-full min-w-0 max-w-full" placeholder="BXS-YYYY-NNNNNN" value={caseNumber} onChange={event => setCaseNumber(event.target.value)}/></label>
        <button className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={linking} type="submit">{linking ? 'Linking…' : 'Confirm link'}</button>
        {linkState.message && <p role="alert" className="w-full text-sm text-red-700">{linkState.message}</p>}
      </form>
    </InboxDisclosure>
    {!linked && <form action={ignoreAction}><input type="hidden" name="messageId" value={messageId}/><button className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50" disabled={ignoring} type="submit">{ignoring ? 'Ignoring…' : 'Ignore'}</button>{ignoreState.message && <p role="alert" className="mt-1 text-sm text-red-700">{ignoreState.message}</p>}</form>}
  </div>;
}
