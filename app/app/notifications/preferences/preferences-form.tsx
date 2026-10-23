'use client';

import { useActionState, useState } from 'react';
import { preferenceCategories, type PreferenceCategory } from '@/lib/notification-preferences';
import { saveNotificationPreferences } from '../actions';

const labels: Record<PreferenceCategory, string> = { TASK: 'Tasks', OPPORTUNITY: 'Opportunities', PRICE_EXCEPTION: 'Price Exceptions', SUPPORT_CASE: 'Support' };

export function NotificationPreferencesForm({ initial, available = preferenceCategories }: { initial: Record<PreferenceCategory, boolean>; available?: readonly PreferenceCategory[] }) {
  const [choices, setChoices] = useState(initial);
  const [edited, setEdited] = useState(false);
  const [result, formAction, pending] = useActionState(saveNotificationPreferences, { status: '' });

  return <form action={formAction} onSubmit={() => setEdited(false)} className="panel max-w-2xl">
    <div className="divide-y divide-slate-100">{available.map(category => <label key={category} className="flex items-center gap-3 p-4 text-sm font-medium"><input type="hidden" name="availableCategory" value={category}/><input type="checkbox" name={category} checked={choices[category]} disabled={pending} onChange={event => { setChoices({ ...choices, [category]: event.target.checked }); setEdited(true); }} className="h-5 w-5 accent-orange-700"/>{labels[category]}</label>)}</div>
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-4"><button className="btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save preferences'}</button><p role="status" aria-live="polite" className={`text-sm ${result.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{pending || edited ? '' : result.status === 'success' ? 'Preferences updated.' : result.status === 'error' ? 'Could not save preferences. Your selections are still here; try again.' : ''}</p></div>
  </form>;
}
