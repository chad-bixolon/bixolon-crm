'use client';
import { useState } from 'react';
import { EntityPicker, type PickerResult } from './entity-picker';

type Account = { id: number; name: string };
export function ContactAccountFilter({ initial, unassigned }: { initial: Account | null; unassigned: boolean }) {
  const [selected, setSelected] = useState<PickerResult | null>(initial ? { ...initial, context: null } : null);
  const [withoutAccount, setWithoutAccount] = useState(unassigned);
  return <div className="min-w-0"><input type="hidden" name="accountId" value={withoutAccount ? 'unassigned' : selected?.id ?? ''}/>
    {withoutAccount ? <div className="filter-control flex items-center justify-between gap-2 rounded border border-slate-300 bg-white px-3"><span>Unassigned</span><button type="button" className="text-orange-800 underline" onClick={() => setWithoutAccount(false)}>Clear</button></div> : <EntityPicker type="account" label="Account" value={selected} onChange={setSelected} placeholder="All accounts · search"/>}
    {!withoutAccount && !selected && <button type="button" className="mt-1 text-xs text-orange-800 underline" onClick={() => { setSelected(null); setWithoutAccount(true); }}>Show unassigned Contacts</button>}
  </div>;
}
