'use client';
import { useActionState, useEffect, useState } from 'react';
import { submitProductSku, type FormState } from '@/app/products/actions';
import { catalogSourceLabels } from '@/lib/product-labels';
type Choice = { id: number; label: string };
function SearchChoice({ kind, name, label, initial }: { kind: 'account' | 'baseSku'; name: string; label: string; initial?: Choice | null }) {
  const [query, setQuery] = useState(initial?.label ?? '');
  const [id, setId] = useState(initial?.id ?? 0);
  const [items, setItems] = useState<Choice[]>([]);
  useEffect(() => {
    if (query.trim().length < 2 || id) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { fetch(`/products/odm-search?kind=${kind}&q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(r => r.json()).then(data => setItems(data.items ?? [])).catch(() => {}); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, id, kind]);
  return <div><label className="label">{label}<input className="field" type="search" value={query} placeholder={`Search ${label.toLowerCase()}`} onChange={e => { setQuery(e.target.value); setId(0); }} /></label><input type="hidden" name={name} value={id || ''}/>{!id && items.length > 0 && <div className="max-h-40 overflow-auto rounded border bg-white">{items.map(item => <button className="block w-full px-2 py-1 text-left text-sm hover:bg-orange-50" type="button" key={item.id} onClick={() => { setQuery(item.label); setId(item.id); setItems([]); }}>{item.label}</button>)}</div>}{query && !id && <p className="text-xs text-amber-700">Select a result to link it, or clear this field.</p>}</div>;
}
function AccountChoices({ initial = [] }: { initial?: { account: { id: number; name: string } }[] }) {
  const [selected, setSelected] = useState<Choice[]>(initial.map(row => ({ id: row.account.id, label: row.account.name })));
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Choice[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { fetch(`/products/odm-search?kind=account&q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(r => r.json()).then(data => setItems(data.items ?? [])).catch(() => {}); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div><label className="label">Associated ODM Customers<input className="field" type="search" value={query} placeholder="Search existing Accounts" onChange={event => setQuery(event.target.value)}/></label>{selected.map(item => <span key={item.id} className="mr-2 inline-flex items-center gap-1 rounded bg-orange-50 px-2 py-1 text-xs">{item.label}<button type="button" aria-label={`Remove ${item.label}`} onClick={() => setSelected(rows => rows.filter(row => row.id !== item.id))}>×</button><input type="hidden" name="odmCustomerAccountIds" value={item.id}/></span>)}{query && items.length > 0 && <div className="max-h-40 overflow-auto rounded border bg-white">{items.filter(item => !selected.some(row => row.id === item.id)).map(item => <button className="block w-full px-2 py-1 text-left text-sm hover:bg-orange-50" type="button" key={item.id} onClick={() => { setSelected(rows => [...rows, item]); setQuery(''); setItems([]); }}>{item.label}</button>)}</div>}</div>;
}
export type SkuInitial = { id: number; partNumber: string; description: string | null; catalogSource: string | null; odmDescription: string | null; odmCustomers: { account: { id: number; name: string } }[]; baseSku: { id: number; partNumber: string; product: { name: string } } | null };
export function ProductSkuForm({ productId, initial }: { productId: number; initial?: SkuInitial }) {
  const [state, action, pending] = useActionState(submitProductSku.bind(null, productId, initial?.id ?? null), { errors: {} } as FormState);
  const [source, setSource] = useState(initial?.catalogSource ?? '');
  return <form action={action} className="space-y-3 rounded border border-slate-200 p-4 text-sm">
    <div className="flex items-center justify-between gap-3"><strong>{initial ? initial.partNumber : 'New SKU'}</strong><button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save SKU'}</button></div>
    {state.message && <p role="status" className={state.message === 'SKU saved.' ? 'text-emerald-700' : 'text-red-700'}>{state.message}</p>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="label">Part number<input className="field" name="partNumber" required maxLength={100} defaultValue={initial?.partNumber}/></label><label className="label">Catalog Source<select className="field" name="catalogSource" value={source} onChange={e => setSource(e.target.value)}><option value="">Unclassified</option>{Object.entries(catalogSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label className="label">Description<input className="field" name="description" maxLength={2000} defaultValue={initial?.description ?? ''}/></label>
    {(source === 'ODM' || source === 'SPECIAL_SKU_LIST') && <div className="grid gap-3 sm:grid-cols-2">{source === 'ODM' && <AccountChoices initial={initial?.odmCustomers}/>}<SearchChoice kind="baseSku" name="baseSkuId" label="Base SKU" initial={initial?.baseSku ? { id: initial.baseSku.id, label: `${initial.baseSku.partNumber} · ${initial.baseSku.product.name}` } : null}/><label className="label sm:col-span-2">{source === 'ODM' ? 'ODM Description' : 'Special SKU Description'}<input className="field" name="odmDescription" maxLength={2000} defaultValue={initial?.odmDescription ?? ''}/></label></div>}
  </form>;
}
