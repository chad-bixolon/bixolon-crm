'use client';
import { HelpLink } from './help-link';

import { useActionState, useState, type ChangeEvent, type ReactNode } from 'react';
import { logEmailResponse } from '@/app/support/cases/outbound-email-actions';
import { calendarLocalInput } from '@/lib/calendar-time';
import { OUTBOUND_EMAIL_SUMMARY_MAX, type OutboundEmailPrefill, type OutboundEmailState } from '@/lib/support-outbound-email-fields';
import { ExpandingTextarea } from './expanding-textarea';

type Props = { caseId: number; context: OutboundEmailPrefill; userName: string; zone: string };
function EmailResponseForm({ caseId, context, userName, zone, close }: Props & { close: () => void }) {
  const [state, action, pending] = useActionState(logEmailResponse.bind(null, caseId), {} as OutboundEmailState);
  const [values, setValues] = useState(() => ({ recipientName: context.recipientName, recipientEmail: context.recipientEmail, subject: context.subject, sentAt: calendarLocalInput(new Date(), zone), summary: '' }));
  const prefix = `email-response-${caseId}`;
  const error = (field: string) => state.errors?.[field] ? <p id={`${prefix}-${field}-error`} className="mt-1 text-sm text-red-700">{state.errors[field]}</p> : null;
  const attributes = (field: keyof typeof values) => ({ id: `${prefix}-${field}`, value: values[field], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(previous => ({ ...previous, [field]: event.target.value })), 'aria-invalid': !!state.errors?.[field], 'aria-describedby': state.errors?.[field] ? `${prefix}-${field}-error` : undefined });
  return <section className="panel mt-3 p-4 sm:p-5" aria-label="Log Email Response">
    <h2 className="font-semibold">Log Email Response</h2>
    <p className="mt-1 text-sm text-slate-600">Send your reply from Gmail first, then record a short summary here. CRM doesn’t send email.</p>
    <HelpLink topic="log-email-response">Help with Log Email Response</HelpLink>
    {state.success ? <><p role="status" className="mt-3 text-sm">{state.message}</p><button type="button" className="btn-secondary mt-3" onClick={close}>Done</button></> : <form action={action} className="mt-4">
      <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
        {[["Related Case", context.caseNumber], ["Account", context.accountName || 'No linked Account'], ["Contact / requester", context.contactName || context.recipientName || 'No linked Contact'], ["Logged by", userName]].map(([label, value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-slate-500">{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor={`${prefix}-recipientName`}>Recipient name (optional)</label><input {...attributes('recipientName')} name="recipientName" className="field" maxLength={200}/>{error('recipientName')}</div>
        <div><label className="label" htmlFor={`${prefix}-recipientEmail`}>Recipient email</label><input {...attributes('recipientEmail')} name="recipientEmail" className="field" type="email" maxLength={254} required/>{error('recipientEmail')}</div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${prefix}-subject`}>Email subject</label><input {...attributes('subject')} name="subject" className="field" maxLength={200} required/>{error('subject')}</div>
        <div><label className="label" htmlFor={`${prefix}-sentAt`}>Sent at ({zone})</label><input {...attributes('sentAt')} name="sentAt" className="field" type="datetime-local" required/>{error('sentAt')}</div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${prefix}-summary`}>Short summary</label><ExpandingTextarea {...attributes('summary')} name="summary" className="field note-textarea" rows={5} maxLength={OUTBOUND_EMAIL_SUMMARY_MAX} required placeholder="Sent updated firmware and asked customer to retest RFID calibration."/>{error('summary')}<p className="mt-1 text-xs text-slate-500">Up to 2,000 characters. Summarize the interaction; keep the full email chain in Gmail.</p></div>
      </div>
      {state.message && <p role="alert" className="mt-3 text-sm text-red-700">{state.message}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Logging…' : 'Log response'}</button><button className="btn-secondary" type="button" disabled={pending} onClick={close}>Cancel</button></div>
    </form>}
  </section>;
}
export function SupportOutboundEmailForm({ children, ...props }: Props & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="mb-5"><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" aria-expanded={open} aria-controls={`outbound-email-panel-${props.caseId}`} onClick={() => setOpen(!open)}>Log Email Response</button>{children}</div>{open && <div id={`outbound-email-panel-${props.caseId}`}><EmailResponseForm {...props} close={() => setOpen(false)}/></div>}</div>;
}
