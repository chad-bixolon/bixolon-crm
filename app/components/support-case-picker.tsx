'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { SearchResultsPopover } from './search-results-popover';

type Option = { id: number; name: string };
export function SupportCasePicker({ kind, label, name, initial, accountId, onPick, error }: { kind: 'account' | 'contact' | 'sku'; label: string; name: string; initial?: Option | null; accountId?: number | null; onPick?: (id: number | null) => void; error?: string }) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Option | null>(initial ?? null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open || (kind === 'contact' && !accountId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => fetch(`/support/cases/search?kind=${kind}&q=${encodeURIComponent(query)}&accountId=${accountId ?? ''}`, { signal: controller.signal }).then(r => r.ok ? r.json() : { results: [] }).then(data => { setResults(data.results); setActive(0); }).catch(() => {}), 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, kind, query, accountId]);
  const choose = (option: Option) => { setSelected(option); onPick?.(option.id); setOpen(false); setQuery(''); };
  return <div className="relative min-w-0"><label className="label" htmlFor={uid}>{label}</label><input type="hidden" name={name} value={selected?.id ?? ''}/><input type="hidden" name={`${name}Query`} value={selected ? '' : query}/><input type="hidden" name={`${name}Label`} value={selected?.name ?? ''}/>{selected ? <div className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded border border-slate-300 px-3 text-sm"><span className="min-w-0 truncate" title={selected.name}>{selected.name}</span><button type="button" className="shrink-0 text-orange-800 underline" onClick={() => { setSelected(null); setQuery(''); onPick?.(null); setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}>Change</button></div> : <><input ref={inputRef} id={uid} className="field" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-invalid={!!error} aria-controls={open ? `${uid}-results` : undefined} aria-activedescendant={open && results[active] ? `${uid}-option-${active}` : undefined} value={query} disabled={kind === 'contact' && !accountId} placeholder={kind === 'contact' && !accountId ? 'Choose a linked CRM Account first' : `Search ${label.toLowerCase()}`} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 100)} onChange={e => { setQuery(e.target.value); setOpen(true); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive(v => Math.min(v + 1, results.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive(v => Math.max(v - 1, 0)); } if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); choose(results[active]); } if (e.key === 'Escape') setOpen(false); }}/>{open && <SearchResultsPopover anchorRef={inputRef} id={`${uid}-results`} activeIndex={active}>{results.map((option, index) => <button key={option.id} id={`${uid}-option-${index}`} type="button" role="option" aria-selected={index === active} data-result-index={index} className={`search-results-option search-results-option-single ${index === active ? 'bg-orange-50' : 'hover:bg-slate-50'}`} title={option.name} onMouseDown={e => e.preventDefault()} onClick={() => choose(option)}>{option.name}</button>)}{results.length === 0 && <p className="p-3 text-sm text-slate-500">No matches.</p>}</SearchResultsPopover>}</>}{error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}</div>;
}
