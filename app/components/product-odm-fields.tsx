'use client';
import { useEffect, useState } from 'react';
import { catalogSourceLabels, odmSubtypeLabels } from '@/lib/product-labels';

type Choice = { id: number; label: string };
type Initial = { odmSubtype: string | null; odmDescription: string | null; odmCustomers: { account: { id: number; name: string } }[]; baseSku: { id: number; partNumber: string; product: { name: string } } | null };

function BaseSkuChoice({ initial }: { initial?: Initial['baseSku'] }) {
  const [query, setQuery] = useState(initial ? `${initial.partNumber} · ${initial.product.name}` : '');
  const [id, setId] = useState(initial?.id ?? 0);
  const [items, setItems] = useState<Choice[]>([]);
  useEffect(() => {
    if (query.trim().length < 2 || id) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { fetch(`/products/odm-search?kind=baseSku&q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(r => r.json()).then(data => setItems(data.items ?? [])).catch(() => {}); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, id]);
  return <div><label className="label">Base SKU<input className="field" type="search" value={query} placeholder="Search base sku" onChange={e => { setQuery(e.target.value); setId(0); }} /></label><input type="hidden" name="baseSkuId" value={id || ''}/>{!id && items.length > 0 && <div className="max-h-40 overflow-auto rounded border bg-white">{items.map(item => <button className="block w-full px-2 py-1 text-left text-sm hover:bg-orange-50" type="button" key={item.id} onClick={() => { setQuery(item.label); setId(item.id); setItems([]); }}>{item.label}</button>)}</div>}{query && !id && <p className="text-xs text-amber-700">Select a result to link it, or clear this field.</p>}</div>;
}

function AccountChoices({ initial = [] }: { initial?: Initial['odmCustomers'] }) {
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

export function CatalogSourceField({ source, onChange }: { source: string; onChange: (value: string) => void }) {
  return <label className="label">Catalog Source<select className="field" name="catalogSource" value={source} onChange={event => onChange(event.target.value)}><option value="">Unclassified</option>{Object.entries(catalogSourceLabels).filter(([value]) => value !== 'SPECIAL_SKU_LIST').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}

export function OdmDetailsFields({ initial }: { initial?: Initial }) {
  return <div className="grid gap-3 sm:grid-cols-2"><label className="label">ODM subtype<select className="field" name="odmSubtype" defaultValue={initial?.odmSubtype ?? ''}><option value="">{initial ? 'Historical: unclassified' : 'Choose subtype'}</option>{Object.entries(odmSubtypeLabels).filter(([value]) => value !== 'LEGACY_SPECIAL_SKU' || initial?.odmSubtype === 'LEGACY_SPECIAL_SKU').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><BaseSkuChoice initial={initial?.baseSku}/><div><AccountChoices initial={initial?.odmCustomers}/><p className="mt-1 text-xs text-slate-500">Customer-Specific requires at least one active Account. Other subtypes may have none.</p></div><label className="label">ODM description / customization notes<input className="field" name="odmDescription" maxLength={2000} defaultValue={initial?.odmDescription ?? ''}/></label></div>;
}
