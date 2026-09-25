'use client';

import { useState } from 'react';

export function ImportSearchPicker({ value, onChange, items, label, emptyLabel = 'Not linked', disabled = false }: { value: number | null; onChange: (id: number | null) => void; items: { id: number; name: string }[]; label: string; emptyLabel?: string; disabled?: boolean }) {
  const [search, setSearch] = useState('');
  const filtered = search ? items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30) : items.slice(0, 30);
  const selected = items.find(item => item.id === value);

  return <div className="min-w-0">
    <input aria-label={`Search ${label}`} className="field mb-1 h-8 min-w-0 px-2 py-1 text-xs" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} placeholder={`Search ${label}`} />
    <select aria-label={label} className="field h-8 min-w-0 px-2 py-1 text-xs" value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{emptyLabel}</option>
      {selected && !filtered.some(item => item.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
      {filtered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </div>;
}
