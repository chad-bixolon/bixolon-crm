'use client';
import { useEffect, useId, useState } from 'react';
import { catalogSourceLabels, odmSubtypeLabels } from '@/lib/product-labels';
import type { ProductSubmittedValues } from '@/app/products/actions';
import { addOdmCustomer, removeOdmCustomer, type OdmCustomerChoice } from '@/lib/odm-customer-selection';
import { calculateOdmCustomerPrice } from '@/lib/odm-customer-pricing';

type Choice = { id: number; label: string };
type Initial = { odmSubtype: string | null; odmDescription: string | null; odmCustomers: { account: { id: number; name: string }; prices?: { currencyCode: string; customerPrice: string; previousPrice: string | null; tariffPercent: string; tariffAmount: string; finalUnitPrice: string; effectiveDate: string | null; notes: string | null }[] }[]; baseSku: { id: number; partNumber: string; product: { name: string } } | null };

function CustomerPriceFields({ accountId, initial, values }: { accountId: number; initial?: Initial['odmCustomers'][number]['prices']; values?: ProductSubmittedValues }) {
  const savedIndex = values?.odmPriceRows?.odmPriceAccountId?.indexOf(String(accountId)) ?? -1;
  const saved = initial?.[0];
  const initialValue = (key: string, fallback = '') => savedIndex >= 0 ? values?.odmPriceRows?.[key]?.[savedIndex] ?? fallback : fallback;
  const [draft, setDraft] = useState({ customerPrice: initialValue('odmCustomerPrice', saved?.customerPrice ?? ''), previousPrice: initialValue('odmPreviousPrice', saved?.previousPrice ?? ''), currencyCode: initialValue('odmCurrencyCode', saved?.currencyCode ?? 'USD'), tariffPercent: initialValue('odmTariffPercent', saved?.tariffPercent ?? ''), tariffAmount: initialValue('odmTariffAmount', saved?.tariffAmount ?? ''), effectiveDate: initialValue('odmEffectiveDate', saved?.effectiveDate ?? ''), notes: initialValue('odmPricingNotes', saved?.notes ?? '') });
  let final = '—'; let error = '';
  if (draft.customerPrice) try { final = `${calculateOdmCustomerPrice(draft).currencyCode} ${calculateOdmCustomerPrice(draft).finalUnitPrice}`; } catch (cause) { error = cause instanceof Error ? cause.message : 'Check pricing values.'; }
  const field = (key: keyof typeof draft, label: string, type = 'text', step?: string) => <label className="label">{label}<input className="field" name={({customerPrice:'odmCustomerPrice',previousPrice:'odmPreviousPrice',currencyCode:'odmCurrencyCode',tariffPercent:'odmTariffPercent',tariffAmount:'odmTariffAmount',effectiveDate:'odmEffectiveDate',notes:'odmPricingNotes'} as Record<string,string>)[key]} type={type} step={step} min={type === 'number' ? '0' : undefined} value={draft[key]} onChange={event => setDraft(old => ({ ...old, [key]: event.target.value }))}/></label>;
  return <div className="mt-2 grid gap-2 rounded border border-orange-100 bg-white p-3 sm:grid-cols-2"><input type="hidden" name="odmPriceAccountId" value={accountId}/>{field('customerPrice','Customer Price','number','0.01')}{field('previousPrice','Previous Price (reference only)','number','0.01')}{field('currencyCode','Currency')}{field('tariffPercent','Tariff %','number','0.0001')}{field('tariffAmount','Tariff Amount','number','0.01')}<div className="self-end text-sm"><strong>Final Unit Price: {final}</strong><p className="text-xs text-slate-500">Customer Price + active tariff</p></div>{field('effectiveDate','Effective Date','date')}{field('notes','Pricing Notes')}{error && <p role="alert" className="text-xs text-red-700 sm:col-span-2">{error}</p>}</div>;
}

function BaseSkuChoice({ initial, values }: { initial?: Initial['baseSku']; values?: ProductSubmittedValues }) {
  const [query, setQuery] = useState(values ? values.baseSkuLabel : initial ? `${initial.partNumber} · ${initial.product.name}` : '');
  const [id, setId] = useState(values ? Number(values.baseSkuId) || 0 : initial?.id ?? 0);
  const [items, setItems] = useState<Choice[]>([]);
  useEffect(() => {
    if (query.trim().length < 2 || id) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { fetch(`/products/odm-search?kind=baseSku&q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(r => r.json()).then(data => setItems(data.items ?? [])).catch(() => {}); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, id]);
  return <div><label className="label">Base SKU<input className="field" type="search" value={query} placeholder="Search base sku" onChange={e => { setQuery(e.target.value); setId(0); }} /></label><input type="hidden" name="baseSkuId" value={id || ''}/><input type="hidden" name="baseSkuLabel" value={query}/>{!id && items.length > 0 && <div className="max-h-40 overflow-auto rounded border bg-white">{items.map(item => <button className="block w-full px-2 py-1 text-left text-sm hover:bg-orange-50" type="button" key={item.id} onClick={() => { setQuery(item.label); setId(item.id); setItems([]); }}>{item.label}</button>)}</div>}{query && !id && <p className="text-xs text-amber-700">Select a result to link it, or clear this field.</p>}</div>;
}

function AccountChoices({ initial = [], values, customerSpecific }: { initial?: Initial['odmCustomers']; values?: ProductSubmittedValues; customerSpecific: boolean }) {
  const uid = useId();
  const [selected, setSelected] = useState<OdmCustomerChoice[]>(values ? values.odmCustomerAccountIds.map((id, index) => ({ id: Number(id), label: values.odmCustomerNames[index] ?? `Account #${id}` })) : initial.map(row => ({ id: row.account.id, label: row.account.name })));
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Choice[]>([]);
  const [fetchedQuery, setFetchedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const search = query.trim();
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setSearchError(false);
      fetch(`/products/odm-search?kind=account&q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error('Account search failed'); return response.json(); })
        .then(data => { setItems(data.items ?? []); setFetchedQuery(search); setActive(0); })
        .catch(() => { if (!controller.signal.aborted) setSearchError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, search]);
  const available = fetchedQuery === search ? items.filter(item => !selected.some(row => row.id === item.id)) : [];
  const choose = (account: Choice) => { setSelected(rows => addOdmCustomer(rows, account)); setQuery(''); setOpen(false); setActive(0); };
  return <div className="min-w-0">
    <div className="relative min-w-0">
      <label className="label" htmlFor={`${uid}-search`}>Associated ODM Customers</label>
      <input id={`${uid}-search`} className="field min-w-0" type="search" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${uid}-results`} aria-activedescendant={open && available[active] ? `${uid}-option-${active}` : undefined} value={query} placeholder="Search active Accounts" onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(value + 1, Math.max(0, available.length - 1))); } if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); } if (event.key === 'Enter' && open) { event.preventDefault(); if (available[active]) choose(available[active]); } if (event.key === 'Escape') setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 100)}/>
      {open && <div id={`${uid}-results`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full max-w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">
        {available.map((account, index) => <button type="button" role="option" aria-selected={index === active} id={`${uid}-option-${index}`} key={account.id} className={`block w-full break-words px-3 py-2 text-left text-sm ${index === active ? 'bg-orange-50' : 'hover:bg-slate-50 focus:bg-orange-50'}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(account)}>{account.label}</button>)}
        {!search && <p className="p-3 text-sm text-slate-500">Type to search active Accounts.</p>}
        {search && searchError && <p className="p-3 text-sm text-red-700" role="alert">Account search failed. Try again.</p>}
        {search && !searchError && (loading || fetchedQuery !== search) && <p className="p-3 text-sm text-slate-500" role="status">Searching…</p>}
        {search && !searchError && !loading && fetchedQuery === search && !available.length && <p className="p-3 text-sm text-slate-500">No matching active Accounts.</p>}
      </div>}
    </div>
    {!!selected.length && <div className="mt-2 space-y-2">{selected.map(item => <div key={item.id} className="rounded bg-orange-50 p-2"><div className="flex items-center justify-between gap-2 text-sm"><strong>{item.label}</strong><button type="button" className="text-orange-800 underline" aria-label={`Remove ${item.label}`} onClick={() => setSelected(rows => removeOdmCustomer(rows, item.id))}>Remove</button></div><input type="hidden" name="odmCustomerAccountIds" value={item.id}/><input type="hidden" name="odmCustomerNames" value={item.label}/>{customerSpecific && <CustomerPriceFields key={item.id} accountId={item.id} initial={initial.find(row => row.account.id === item.id)?.prices} values={values}/>}</div>)}</div>}
  </div>;
}

export function CatalogSourceField({ source, onChange }: { source: string; onChange: (value: string) => void }) {
  return <label className="label">Catalog Source<select className="field" name="catalogSource" value={source} onChange={event => onChange(event.target.value)}><option value="">Unclassified</option>{Object.entries(catalogSourceLabels).filter(([value]) => value !== 'SPECIAL_SKU_LIST').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}

export function OdmDetailsFields({ initial, values }: { initial?: Initial; values?: ProductSubmittedValues }) {
  const [subtype, setSubtype] = useState(values?.odmSubtype ?? initial?.odmSubtype ?? '');
  return <div className="grid gap-3 sm:grid-cols-2"><label className="label">ODM subtype<select className="field" name="odmSubtype" value={subtype} onChange={event => setSubtype(event.target.value)}><option value="">{initial ? 'Historical: unclassified' : 'Choose subtype'}</option>{Object.entries(odmSubtypeLabels).filter(([value]) => value !== 'LEGACY_SPECIAL_SKU' || initial?.odmSubtype === 'LEGACY_SPECIAL_SKU').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><BaseSkuChoice initial={initial?.baseSku} values={values}/><div className="sm:col-span-2"><AccountChoices initial={initial?.odmCustomers} values={values} customerSpecific={subtype === 'CUSTOMER_SPECIFIC'}/><p className="mt-1 text-xs text-slate-500">Customer-Specific requires at least one active Account. Pricing may be left blank for manual Opportunity pricing.</p></div><label className="label">ODM description / customization notes<input className="field" name="odmDescription" maxLength={2000} defaultValue={values?.odmDescription ?? initial?.odmDescription ?? ''}/></label></div>;
}
