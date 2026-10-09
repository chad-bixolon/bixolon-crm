'use client';
import { useState } from 'react';
import { EntityPicker, type PickerResult } from './entity-picker';

export type PriceExceptionAccountOption = { id: number; name: string; status: string; archivedAt: string | null };
export function PriceExceptionAccountPicker({ name, label, initial, error }: { name: string; label: string; initial: PriceExceptionAccountOption | null; error?: string }) {
  const [selected, setSelected] = useState<PickerResult | null>(initial ? { id: initial.id, name: initial.name, context: initial.status !== 'ACTIVE' || initial.archivedAt ? 'Historical / inactive' : null } : null);
  const [previous, setPrevious] = useState<PickerResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);
  return <div className="min-w-0">
    <input type="hidden" name={name} value={selected?.id ?? ''}/>
    <input type="hidden" name={`${name}Searching`} value={editing || query.trim() ? 'true' : ''}/>
    <EntityPicker key={version} type="account" label={label} value={selected} onQueryChange={setQuery} onChange={item => { if (!item && selected) { setPrevious(selected); setEditing(true); } else if (item) { setPrevious(null); setEditing(false); } setSelected(item); }} error={error} placeholder="Search existing active Accounts"/>
    {editing && <button type="button" className="mt-2 text-sm text-orange-800 underline" onClick={() => { setSelected(previous); setPrevious(null); setEditing(false); setQuery(''); setVersion(old => old + 1); }}>Cancel search</button>}
    {selected && <button type="button" className="mt-2 ml-3 text-sm text-slate-600 underline" onClick={() => { setSelected(null); setPrevious(null); setEditing(false); setQuery(''); setVersion(old => old + 1); }}>Clear</button>}
  </div>;
}
