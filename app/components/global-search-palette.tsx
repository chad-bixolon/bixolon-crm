'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { GlobalSearchResult } from '@/lib/global-search';

export function GlobalSearchPalette({ productName = 'SalesHub' }: { productName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const close = () => { setOpen(false); setQuery(''); setResults([]); setActive(0); requestAnimationFrame(() => trigger.current?.focus()); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) { setOpen(false); setQuery(''); setResults([]); requestAnimationFrame(() => trigger.current?.focus()); }
        else setOpen(true);
      }
      if (event.key === 'Escape' && open) { setOpen(false); setQuery(''); setResults([]); requestAnimationFrame(() => trigger.current?.focus()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()); }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/global-search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json() as { results: GlobalSearchResult[] };
        setResults(data.results); setActive(0);
      } catch { if (!controller.signal.aborted) setResults([]); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [open, query]);
  useEffect(() => { optionRefs.current[active]?.scrollIntoView({ block: 'nearest' }); }, [active, results]);
  const choose = (result: GlobalSearchResult) => { close(); router.push(result.href); };
  const groups = [...new Set(results.map(result => result.group))];
  return <><button ref={trigger} type="button" className="btn-secondary flex min-h-11 items-center gap-2" aria-label={`Search ${productName}`} onClick={() => setOpen(true)}><span aria-hidden="true">⌕</span><span className="hidden md:inline">Search</span><span className="hidden text-xs text-slate-500 lg:inline">⌘/Ctrl K</span></button>
    {open && <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/50 px-3 pt-[8vh] sm:px-6" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialog} role="dialog" aria-modal="true" aria-label={`Search ${productName}`} className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl" onKeyDown={event => { if (event.key === 'Tab') { const focusable = [...dialog.current!.querySelectorAll<HTMLElement>('input,button')]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <div className="flex items-center gap-2 border-b border-slate-200 p-3"><input ref={input} role="combobox" aria-label="Search Accounts, Contacts, Opportunities, Projects, Support Cases, and Products" aria-autocomplete="list" aria-expanded="true" aria-controls="global-search-results" aria-activedescendant={results[active] ? `global-search-option-${active}` : undefined} className="field min-w-0 flex-1" placeholder={`Search ${productName}…`} value={query} onChange={event => { const value = event.target.value; setQuery(value); setResults([]); setActive(0); setLoading(value.trim().length >= 2); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (results.length) setActive(value => Math.min(results.length - 1, value + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)); } if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active]); } }}/><button type="button" className="btn-secondary" onClick={close}>Close</button></div>
      <div id="global-search-results" role="listbox" aria-label="Search results" className="max-h-[min(65vh,32rem)] overflow-y-auto p-2">{query.trim().length < 2 ? <p className="p-3 text-sm text-slate-600">Type at least 2 characters to search.</p> : loading ? <p className="p-3 text-sm text-slate-600">Searching…</p> : results.length ? <>{groups.map(group => <div role="group" aria-label={group} key={group}><h2 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h2>{results.map((result, index) => result.group === group && <button ref={element => { optionRefs.current[index] = element; }} role="option" id={`global-search-option-${index}`} aria-selected={active === index} type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(result)} className={`block w-full rounded-md px-3 py-2 text-left ${active === index ? 'bg-orange-50 ring-1 ring-orange-400' : 'hover:bg-slate-50'}`} key={`${result.href}-${index}`}><span className="block break-words text-sm font-medium">{result.label}</span>{result.context && <span className="block break-words text-xs text-slate-600">{result.context}</span>}</button>)}</div>)}<p className="px-3 py-2 text-xs text-slate-500">Keep typing to narrow results.</p></> : <p className="p-3 text-sm text-slate-600">No matching records. Keep typing to narrow results.</p>}</div>
    </div></div>}
  </>;
}
