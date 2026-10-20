'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { normalizeSavedQuery, savedQueryHref, type SavedQuery, type SavedViewRoute } from '@/lib/saved-views';

type View = { id: number; name: string; isDefault: boolean; query: SavedQuery; omitted: string[] };
const same = (a: SavedQuery, b: SavedQuery) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const listen = (callback: () => void) => { window.addEventListener('storage', callback); window.addEventListener('saved-view-change', callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener('saved-view-change', callback); }; };

export function SavedViewControl({ routeKey, initialViews }: { routeKey: SavedViewRoute; initialViews: View[] }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const [views, setViews] = useState(initialViews), [formQuery, setFormQuery] = useState<SavedQuery | null>(null), [mode, setMode] = useState<'closed'|'save'|'manage'>('closed');
  const [name, setName] = useState(''), [makeDefault, setMakeDefault] = useState(false), [allowEmpty, setAllowEmpty] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const selectedId = useSyncExternalStore(listen, () => Number(sessionStorage.getItem(`saved-view:${routeKey}`)) || 0, () => 0);
  const details = useRef<HTMLDetailsElement>(null);
  const current = normalizeSavedQuery(routeKey, Object.fromEntries(params.entries()));
  const draft = formQuery ?? current;
  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>(`form.responsive-filter-form`);
    if (!form) return;
    let pending = 0;
    const update = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => setFormQuery(normalizeSavedQuery(routeKey, Object.fromEntries(new FormData(form).entries())))); };
    form.addEventListener('input', update); form.addEventListener('change', update);
    return () => { cancelAnimationFrame(pending); form.removeEventListener('input', update); form.removeEventListener('change', update); };
  }, [routeKey, pathname]);
  const selected = views.find(view => view.id === selectedId) ?? views.find(view => same(current, view.query));
  const modified = !!selected && !same(draft, selected.query);
  const active = selected ? `${selected.name}${modified ? ' · Modified' : ''}` : 'Saved views';
  const request = async (method: 'POST'|'PATCH'|'DELETE', payload: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/saved-views', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeKey, ...payload }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? 'Could not update saved views.'); return false; }
      setViews(result.views); router.refresh(); return true;
    } catch { setError('Could not update saved views.'); return false; }
    finally { setBusy(false); }
  };
  const apply = (view: View) => {
    sessionStorage.setItem(`saved-view:${routeKey}`, String(view.id)); window.dispatchEvent(new Event('saved-view-change'));
    details.current?.removeAttribute('open');
    if (view.omitted.length) setError(`${view.omitted.join(', ')} filter was omitted because it is no longer available.`);
    const href = savedQueryHref(routeKey, view.query);
    if (href !== `${pathname}${params.size ? `?${params}` : ''}`) router.push(href);
    else if ((routeKey === 'tasks' || routeKey === 'trade-show-follow-up') && view.query.duePeriod && view.query.duePeriod !== 'custom') router.refresh();
  };
  const save = async () => {
    if (!name.trim()) { setError('Enter a view name.'); return; }
    if (await request('POST', { name, query: draft, isDefault: makeDefault, allowEmpty })) { setName(''); setMakeDefault(false); setAllowEmpty(false); setMode('closed'); details.current?.removeAttribute('open'); }
  };
  const rename = async (view: View) => { const next = window.prompt('Rename saved view', view.name); if (next !== null) await request('PATCH', { id: view.id, action: 'rename', name: next }); };
  const remove = async (view: View) => { if (window.confirm(`Delete “${view.name}”?`)) { if (await request('DELETE', { id: view.id })) { if (selectedId === view.id) { sessionStorage.removeItem(`saved-view:${routeKey}`); window.dispatchEvent(new Event('saved-view-change')); } } } };
  return <div className="saved-views-row">
    <details ref={details} className="saved-views-menu"><summary className="btn-secondary"><span className="saved-views-label" title={active}>{active}</span><span aria-hidden="true">▾</span></summary><div className="saved-views-options">
      {views.length ? views.map(view => <button key={view.id} type="button" onClick={() => apply(view)}>{view.name}{view.isDefault ? ' ★' : ''}</button>) : <p>No saved views yet</p>}
      <button type="button" onClick={() => { setMode('save'); details.current?.removeAttribute('open'); setError(''); }}>Save current view</button>
      <button type="button" onClick={() => { setMode('manage'); details.current?.removeAttribute('open'); setError(''); }}>Manage views</button>
    </div></details>
    {error && mode === 'closed' && <span role="alert" className="text-sm text-amber-800">{error}</span>}
    {mode !== 'closed' && <div className="saved-views-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setMode('closed'); }}><section role="dialog" aria-modal="true" aria-label={mode === 'save' ? 'Save current view' : 'Manage saved views'} className="saved-views-dialog">
      <h2 className="text-lg font-semibold">{mode === 'save' ? 'Save current view' : 'Manage views'}</h2>
      {mode === 'save' ? <><label className="label">View name<input className="field" maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label><label className="saved-views-check"><input type="checkbox" checked={makeDefault} onChange={event => setMakeDefault(event.target.checked)}/> Make this my default view</label>{!Object.keys(draft).length && <label className="saved-views-check"><input type="checkbox" checked={allowEmpty} onChange={event => setAllowEmpty(event.target.checked)}/> Save a named view of the default list</label>}</> : <div className="saved-views-manage">{views.length ? views.map(view => <div key={view.id} className="saved-views-item"><span>{view.name}{view.isDefault ? ' · Default' : ''}</span><div><button disabled={busy} type="button" onClick={() => rename(view)}>Rename</button><button disabled={busy} type="button" onClick={() => request('PATCH', { id: view.id, action: 'default', isDefault: !view.isDefault })}>{view.isDefault ? 'Clear default' : 'Make default'}</button><button disabled={busy} type="button" onClick={() => remove(view)}>Delete</button></div></div>) : <p>No saved views yet</p>}</div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="form-action-row"><button className="btn-secondary" type="button" onClick={() => setMode('closed')}>Close</button>{mode === 'save' && <button className="btn-primary" type="button" disabled={busy} onClick={save}>Save view</button>}</div>
    </section></div>}
  </div>;
}
