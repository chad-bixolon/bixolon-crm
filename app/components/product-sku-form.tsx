'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { submitProductSku, type FormState } from '@/app/products/actions';
import { CatalogSourceField, OdmDetailsFields } from '@/components/product-odm-fields';
export type SkuInitial = { id: number; partNumber: string; description: string | null; active: boolean; catalogSource: string | null; odmSubtype: string | null; odmDescription: string | null; odmCustomers: { account: { id: number; name: string }; prices: { currencyCode: string; customerPrice: string; previousPrice: string | null; tariffPercent: string; tariffAmount: string; finalUnitPrice: string; effectiveDate: string | null; notes: string | null }[] }[]; baseSku: { id: number; partNumber: string; product: { name: string } } | null };
export function ProductSkuForm({ productId, initial }: { productId: number; initial?: SkuInitial }) {
  const [state, action, pending] = useActionState(submitProductSku.bind(null, productId, initial?.id ?? null), { errors: {} } as FormState);
  const [source, setSource] = useState(state.values?.catalogSource ?? initial?.catalogSource ?? '');
  return <form action={action} className="space-y-3 rounded border border-slate-200 p-4 text-sm">
    <div className="flex items-center justify-between gap-3"><strong>{initial ? initial.partNumber : 'New SKU'}</strong><button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save SKU'}</button></div>
    {state.message && <p role="alert" className="text-red-700">{state.message}{state.existingSku && <> <Link className="underline" href={state.existingSku.href}>Open {state.existingSku.label}</Link>.</>}</p>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="label">Part number<input className="field" name="partNumber" required maxLength={100} defaultValue={state.values?.sku || initial?.partNumber}/></label><CatalogSourceField source={source} onChange={setSource}/></div>
    <label className="label">Description<input className="field" name="description" maxLength={2000} defaultValue={state.values?.description ?? initial?.description ?? ''}/></label>
    <label className="label">Status<select className="field" name="active" defaultValue={state.values?.active ?? (initial?.active === false ? 'false' : 'true')}><option value="true">Active</option><option value="false">Inactive</option></select></label>
    {source === 'ODM' && <OdmDetailsFields initial={initial} values={state.values}/>}
  </form>;
}
