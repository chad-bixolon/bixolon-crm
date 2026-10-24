'use client';

import { useState, useTransition } from 'react';
import type { AppearancePreference } from '@prisma/client';
import { saveMyAppearance } from '@/app/my-integrations/actions';

export function AppearanceControl({ initial }: { initial: AppearancePreference }) {
  const [choice, setChoice] = useState<AppearancePreference>(initial);
  const [status, setStatus] = useState('');
  const [pending, startTransition] = useTransition();

  function change(value: AppearancePreference) {
    const previous = choice;
    setChoice(value);
    setStatus('Saving appearance…');
    document.documentElement.dataset.appearance = value.toLowerCase();
    startTransition(async () => {
      try {
        await saveMyAppearance(value);
        setStatus('Appearance saved.');
      } catch {
        document.documentElement.dataset.appearance = previous.toLowerCase();
        setChoice(previous);
        setStatus('Appearance could not be saved. Try again.');
      }
    });
  }

  return <div className="max-w-sm">
    <label className="label" htmlFor="appearance-preference">Appearance</label>
    <select id="appearance-preference" className="field" value={choice} disabled={pending} onChange={event => change(event.target.value as AppearancePreference)}>
      <option value="SYSTEM">System</option>
      <option value="LIGHT">Light</option>
      <option value="DARK">Dark</option>
    </select>
    <p className="mt-2 text-sm text-slate-600">System follows your device&apos;s light or dark appearance setting.</p>
    <p className="mt-1 text-xs text-slate-500" role="status" aria-live="polite">{status}</p>
  </div>;
}
