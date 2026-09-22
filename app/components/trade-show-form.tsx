'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { changeTradeShowArchive, submitTradeShow, type TradeShowFormState } from '@/app/trade-shows/actions';
import { useSubmitGuard } from '@/lib/submit-guard';

type Owner = { id: number; firstName: string; lastName: string };
type Initial = { name: string; startDate: Date | null; endDate: Date | null; location: string | null; timezone: string | null; description: string | null; marketingOwnerId: number | null };

export function TradeShowForm({ id, initial, owners }: { id?: number; initial?: Initial; owners: Owner[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitTradeShow.bind(null, id ?? null), { errors: {} } as TradeShowFormState);
  const guard = useSubmitGuard(state);
  const val = (key: string, fallback = '') => state.values?.[key] ?? fallback;
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  useEffect(() => { if (state.redirectTo) router.push(state.redirectTo); }, [state.redirectTo, router]);
  const ownerOptions = [...owners];
  if (initial?.marketingOwnerId && !ownerOptions.some(owner => owner.id === initial.marketingOwnerId)) ownerOptions.push({ id: initial.marketingOwnerId, firstName: 'Current owner', lastName: '(inactive)' });
  return <form key={JSON.stringify(state.values ?? {})} action={action} onSubmit={guard} className="panel max-w-3xl space-y-5 p-6" aria-label={id ? 'Edit Trade Show' : 'Create Trade Show'}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div><label className="label" htmlFor="name">Name *</label><input className="field" id="name" name="name" required maxLength={200} defaultValue={val('name', initial?.name ?? '')}/>{error('name')}</div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label className="label" htmlFor="startDate">Start Date</label><input className="field" type="date" id="startDate" name="startDate" defaultValue={val('startDate', initial?.startDate?.toISOString().slice(0,10) ?? '')}/>{error('startDate')}</div>
      <div><label className="label" htmlFor="endDate">End Date</label><input className="field" type="date" id="endDate" name="endDate" defaultValue={val('endDate', initial?.endDate?.toISOString().slice(0,10) ?? '')}/>{error('endDate')}</div>
    </div>
    <div><label className="label" htmlFor="location">Location</label><input className="field" id="location" name="location" maxLength={300} defaultValue={val('location', initial?.location ?? '')}/>{error('location')}</div>
    <div><label className="label" htmlFor="timezone">Event Timezone</label><input className="field" id="timezone" name="timezone" maxLength={100} placeholder="America/New_York" defaultValue={val('timezone', initial?.timezone ?? '')}/><p className="mt-1 text-xs text-slate-500">Use an IANA timezone. Capture timestamps will be interpreted using this timezone when import is added.</p>{error('timezone')}</div>
    <div><label className="label" htmlFor="marketingOwnerId">Marketing Owner</label><select className="field" id="marketingOwnerId" name="marketingOwnerId" defaultValue={val('marketingOwnerId', initial?.marketingOwnerId?.toString() ?? '')}><option value="">Unassigned</option>{ownerOptions.map(owner => <option key={owner.id} value={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select>{error('marketingOwnerId')}</div>
    <div><label className="label" htmlFor="description">Description / Notes</label><textarea className="field min-h-28" id="description" name="description" maxLength={5000} defaultValue={val('description', initial?.description ?? '')}/>{error('description')}</div>
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href={id ? `/trade-shows/${id}` : '/trade-shows'}>Cancel</Link><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : id ? 'Save Trade Show' : 'Create Trade Show'}</button></div>
  </form>;
}

export function TradeShowArchiveControl({ id, archived }: { id: number; archived: boolean }) {
  const [state, action, pending] = useActionState(changeTradeShowArchive.bind(null, id, !archived), { errors: {} } as TradeShowFormState);
  return <form action={action}><button className="btn-secondary" disabled={pending}>{archived ? 'Reactivate Trade Show' : 'Archive Trade Show'}</button>{state.message && <span role="status" className="ml-3 text-sm">{state.message}</span>}</form>;
}
