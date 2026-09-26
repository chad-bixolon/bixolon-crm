'use client';

import { useState } from 'react';

export function ImportSearchPicker({ value, onChange, items, label, emptyLabel = 'Not linked', disabled = false }: { value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string; emptyLabel?: string; disabled?: boolean }) {
  const [search, setSearch] = useState('');
  const filtered = search ? items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30) : items.slice(0, 30);
  const selected = items.find(item => item.id === value);

  return <div className="min-w-0 w-full">
    <input aria-label={`Search ${label}`} className="field mb-1 h-9 w-full min-w-0 px-2 py-1 text-sm" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} placeholder={`Search ${label}`} />
    <select aria-label={label} title={selected?.name} className="field h-9 w-full min-w-0 px-2 py-1 text-sm" value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {selected && !filtered.some(item => item.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
      {filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {selected && <p className="mt-1 break-words text-sm text-slate-700" aria-live="polite">Selected: {selected.name}</p>}
    {search && <p className="mt-1 text-xs text-slate-500" role="status">{filtered.length} matching result{filtered.length === 1 ? '' : 's'}{filtered.length === 30 ? ' shown' : ''}</p>}
  </div>;
}
