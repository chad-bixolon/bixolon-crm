'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { changeTradeShowArchive, submitTradeShow, type TradeShowFormState } from '@/app/trade-shows/actions';
import { useSubmitGuard } from '@/lib/submit-guard';
import { isApprovedTradeShowTimezone, TRADE_SHOW_TIMEZONE_GROUPS } from '@/lib/trade-show-timezones';

type Owner = { id: number; firstName: string; lastName: string };
type Initial = { name: string; startDate: Date | null; endDate: Date | null; location: string | null; timezone: string | null; description: string | null; marketingOwnerId: number | null; boothNumber: string | null; resourceLinks: { id: number; label: string; url: string }[] };

export function TradeShowForm({ id, initial, owners, currentOwner }: { id?: number; initial?: Initial; owners: Owner[]; currentOwner?: {firstName:string;lastName:string}|null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitTradeShow.bind(null, id ?? null), { errors: {} } as TradeShowFormState);
  const nextLinkKey = useRef(0);
  const [resourceLinks, setResourceLinks] = useState<{ id: number | null; label: string; url: string; key: string }[]>(() => initial?.resourceLinks.map(link => ({ ...link, key: `saved-${link.id}` })) ?? []);
  const updateLink = (key: string, field: 'label' | 'url', value: string) => setResourceLinks(rows => rows.map(row => row.key === key ? { ...row, [field]: value } : row));
  const guard = useSubmitGuard(state);
  const val = (key: string, fallback = '') => state.values?.[key] ?? fallback;
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  useEffect(() => { if (state.redirectTo) router.push(state.redirectTo); }, [state.redirectTo, router]);
  const selectedTimezone = val('timezone', initial?.timezone ?? '');
  const unsupportedTimezone = selectedTimezone && !isApprovedTradeShowTimezone(selectedTimezone) ? selectedTimezone : null;
  return <form key={JSON.stringify(state.values ?? {})} action={action} onSubmit={guard} className="panel max-w-3xl space-y-4 p-5 sm:p-6" aria-label={id ? 'Edit Trade Show' : 'Create Trade Show'}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div className="min-w-0"><label className="label" htmlFor="name">Name *</label><input className="field h-11 min-w-0" id="name" name="name" required maxLength={200} defaultValue={val('name', initial?.name ?? '')}/>{error('name')}</div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="min-w-0"><label className="label" htmlFor="startDate">Start Date</label><input className="field h-11 min-w-0" type="date" id="startDate" name="startDate" defaultValue={val('startDate', initial?.startDate?.toISOString().slice(0,10) ?? '')}/>{error('startDate')}</div>
      <div className="min-w-0"><label className="label" htmlFor="endDate">End Date</label><input className="field h-11 min-w-0" type="date" id="endDate" name="endDate" defaultValue={val('endDate', initial?.endDate?.toISOString().slice(0,10) ?? '')}/>{error('endDate')}</div>
    </div>
    <div className="min-w-0"><label className="label" htmlFor="location">Location</label><input className="field h-11 min-w-0" id="location" name="location" maxLength={300} defaultValue={val('location', initial?.location ?? '')}/>{error('location')}</div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="min-w-0"><label className="label" htmlFor="timezone">Event Timezone *</label><select className="field h-11 min-w-0" id="timezone" name="timezone" required defaultValue={selectedTimezone}><option value="">Select event timezone</option>{unsupportedTimezone && <option value={unsupportedTimezone} disabled>Unsupported timezone: {unsupportedTimezone} — select another</option>}{TRADE_SHOW_TIMEZONE_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</select><p className="mt-1 text-xs text-slate-500">Used for imported lead timestamps.</p>{error('timezone')}</div>
      <div className="min-w-0"><label className="label" htmlFor="marketingOwnerId">Marketing Owner</label><select className="field h-11 min-w-0" id="marketingOwnerId" name="marketingOwnerId" defaultValue={val('marketingOwnerId', initial?.marketingOwnerId?.toString() ?? '')}><option value="">Unassigned</option>{id && initial?.marketingOwnerId && !owners.some(owner => owner.id === initial.marketingOwnerId) && <optgroup label="Current assignment"><option value={initial.marketingOwnerId}>{currentOwner ? `${currentOwner.firstName} ${currentOwner.lastName}` : `User #${initial.marketingOwnerId}`} (no longer eligible)</option></optgroup>}{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select>{error('marketingOwnerId')}</div>
    </div>
    <div className="min-w-0"><label className="label" htmlFor="description">Description / Notes</label><textarea className="field min-h-24 resize-y" rows={3} id="description" name="description" maxLength={5000} defaultValue={val('description', initial?.description ?? '')}/>{error('description')}</div>
    <section className="min-w-0 space-y-3 border-t border-slate-200 pt-4" aria-label="Show resources">
      <h2 className="font-semibold">Show resources</h2>
      <div className="min-w-0"><label className="label" htmlFor="boothNumber">Booth number</label><input className="field h-11 min-w-0" id="boothNumber" name="boothNumber" maxLength={300} defaultValue={val('boothNumber', initial?.boothNumber ?? '')}/>{error('boothNumber')}</div>
      <div><h3 className="text-sm font-semibold">Resource links</h3>{error('resourceLinks')}</div>
      <div className="space-y-3">{resourceLinks.map((link, index) => <div className="grid min-w-0 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start" key={link.key}>
        <input type="hidden" name="resourceId" value={link.id ?? ''}/>
        <div className="min-w-0"><label className="label" htmlFor={`resource-label-${link.key}`}>Label</label><input className="field h-11 min-w-0" id={`resource-label-${link.key}`} name="resourceLabel" maxLength={120} value={link.label} onChange={event => updateLink(link.key, 'label', event.target.value)}/>{error(`resourceLabel.${index}`)}</div>
        <div className="min-w-0"><label className="label" htmlFor={`resource-url-${link.key}`}>URL</label><input className="field h-11 min-w-0" type="url" id={`resource-url-${link.key}`} name="resourceUrl" maxLength={2048} value={link.url} onChange={event => updateLink(link.key, 'url', event.target.value)} placeholder="https://example.com"/>{error(`resourceUrl.${index}`)}</div>
        <button className="btn-secondary sm:mt-6" type="button" onClick={() => setResourceLinks(rows => rows.filter(row => row.key !== link.key))} aria-label={`Remove ${link.label || `resource link ${index + 1}`}`}>Remove</button>
      </div>)}</div>
      <button className="btn-secondary" type="button" disabled={resourceLinks.length >= 50} onClick={() => setResourceLinks(rows => [...rows, { id: null, label: '', url: '', key: `new-${nextLinkKey.current++}` }])}>Add link</button>
    </section>
    <div className="flex flex-wrap justify-end gap-2"><Link className="btn-secondary" href={id ? `/trade-shows/${id}` : '/trade-shows'}>Cancel</Link><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save Trade Show' : 'Create Trade Show'}</button></div>
  </form>;
}

export function TradeShowArchiveControl({ id, archived }: { id: number; archived: boolean }) {
  const [state, action, pending] = useActionState(changeTradeShowArchive.bind(null, id, !archived), { errors: {} } as TradeShowFormState);
  return <form action={action}><button className="btn-secondary" disabled={pending}>{archived ? 'Reactivate Trade Show' : 'Archive Trade Show'}</button>{state.message && <span role="status" className="ml-3 text-sm">{state.message}</span>}</form>;
}
