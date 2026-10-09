'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SearchResultsPopover } from './search-results-popover';
import type { EntitySearchResult, EntityType } from '@/lib/entity-search';

const plural: Record<EntityType, string> = { account: 'Accounts', contact: 'Contacts', opportunity: 'Opportunities', project: 'Projects' };
export type PickerResult = EntitySearchResult;
type Props = {
  type: EntityType; label: string; name?: string; initial?: PickerResult | null;
  value?: PickerResult | null; onChange?: (value: PickerResult | null) => void; onQueryChange?: (query: string) => void;
  filters?: { accountId?: number | null; opportunityId?: number | null; projectId?: number | null; excludeProjectId?: number | null; openOnly?: boolean; projectStatus?: 'PLANNING' | 'ACTIVE'; partnerOnly?: boolean; includeUnassigned?: boolean; editableOnly?: boolean };
  disabled?: boolean; required?: boolean; error?: string; placeholder?: string;
  renderResult?: (result: PickerResult) => ReactNode;
};

export function EntityPicker({ type, label, name, initial = null, value, onChange, onQueryChange, filters, disabled, required, error, placeholder, renderResult }: Props) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const [local, setLocal] = useState<PickerResult | null>(initial);
  const selected = value === undefined ? local : value;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickerResult[]>([]);
  const [dataKey, setDataKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filterKey = JSON.stringify(filters ?? {});
  const requestKey = `${type}:${query.trim()}:${filterKey}`;
  const visibleResults = dataKey === requestKey ? results : [];
  const isLoading = loading || (query.trim().length >= 2 && dataKey !== requestKey);
  const pick = (item: PickerResult | null) => { requestSeq.current += 1; if (value === undefined) setLocal(item); onChange?.(item); onQueryChange?.(''); setQuery(''); setResults([]); setOpen(false); setActive(0); };
  useEffect(() => {
    if (!open || selected || query.trim().length < 2 || disabled) return;
    const controller = new AbortController();
    const sequence = ++requestSeq.current;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ type, q: query.trim() });
      for (const [key, filter] of Object.entries(JSON.parse(filterKey) as Record<string, string | number | boolean | null>)) if (filter !== null && filter !== undefined && filter !== false) params.set(key, String(filter));
      try {
        const response = await fetch(`/api/entity-search?${params}`, { signal: controller.signal });
        const data = response.ok ? await response.json() as { results: PickerResult[] } : { results: [] };
        if (!controller.signal.aborted && sequence === requestSeq.current) { setResults(data.results); setDataKey(requestKey); setLoading(false); setActive(0); }
      } catch { if (!controller.signal.aborted && sequence === requestSeq.current) { setResults([]); setDataKey(requestKey); setLoading(false); } }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, selected, query, type, filterKey, requestKey, disabled]);
  const searching = open && !selected && query.trim().length >= 2;
  return <div className="min-w-0">
    {name && <><input type="hidden" name={name} value={selected?.id ?? ''}/><input type="hidden" name={`${name}Query`} value={selected ? '' : query}/><input type="hidden" name={`${name}Label`} value={selected?.name ?? ''}/></>}
    <label className="label" htmlFor={uid}>{label}{required ? ' *' : ''}</label>
    {selected ? <div className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded border border-slate-300 bg-white px-3 py-1 text-sm"><span className="min-w-0 truncate" title={selected.name}><strong>{selected.name}</strong>{selected.context && <span className="ml-2 text-slate-600">{selected.context}</span>}</span>{!disabled && <button type="button" className="shrink-0 text-orange-800 underline" onClick={() => { pick(null); setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}>Change</button>}</div> : <input ref={inputRef} id={uid} className="field min-w-0" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-invalid={!!error} aria-controls={open ? `${uid}-results` : undefined} aria-activedescendant={open && visibleResults[active] && !isLoading ? `${uid}-option-${active}` : undefined} value={query} disabled={disabled} placeholder={placeholder ?? `Search ${plural[type]}...`} onFocus={() => { setOpen(true); if (query.trim().length >= 2) setLoading(true); }} onBlur={() => setTimeout(() => setOpen(false), 100)} onChange={event => { requestSeq.current += 1; setQuery(event.target.value); onQueryChange?.(event.target.value); setResults([]); setLoading(event.target.value.trim().length >= 2); setActive(0); setOpen(true); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); setActive(index => Math.min(index + 1, Math.max(0, visibleResults.length - 1))); } if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); } if (event.key === 'Enter' && open && !isLoading && visibleResults[active]) { event.preventDefault(); pick(visibleResults[active]); } if (event.key === 'Escape') setOpen(false); }}/>}
    {open && !selected && <SearchResultsPopover anchorRef={inputRef} id={`${uid}-results`} activeIndex={active}>
      {!searching ? <p className="p-3 text-sm text-slate-600">Type at least 2 characters to search.</p> : isLoading ? <p className="p-3 text-sm text-slate-600" role="status">Searching...</p> : visibleResults.length ? visibleResults.map((result, index) => <button key={result.id} type="button" role="option" id={`${uid}-option-${index}`} data-result-index={index} aria-selected={index === active} className={`search-results-option search-results-option-single ${index === active ? 'bg-orange-50' : 'hover:bg-slate-50'}`} onMouseDown={event => event.preventDefault()} onClick={() => pick(result)}>{renderResult ? renderResult(result) : <><span className="block font-medium">{result.name}</span>{result.context && <span className="block text-xs text-slate-600">{result.context}</span>}</>}</button>) : <p className="p-3 text-sm text-slate-600">No matching {plural[type]}.</p>}
    </SearchResultsPopover>}
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
  </div>;
}
