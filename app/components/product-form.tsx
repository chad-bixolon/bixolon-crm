"use client";
import { useSubmitGuard } from "@/lib/submit-guard";
import Link from "next/link";
import { useActionState, useState } from "react";
import { submitProduct, type FormState } from "@/app/products/actions";
import { CatalogSourceField, OdmDetailsFields } from "@/components/product-odm-fields";
export function ProductForm({ id, initial, categories = [] }: { id?: number; initial?: { sku: string; name: string; active: boolean; categoryId: number | null }; categories?: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(submitProduct.bind(null, id ?? null), { errors: {} } as FormState);
  const [source, setSource] = useState('');
  const guard = useSubmitGuard(state);
  return <form action={action} onSubmit={guard} className="panel max-w-2xl space-y-4 p-6" aria-label={id ? "Edit product" : "Create product"}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}{state.existingSku && <> <Link className="underline" href={state.existingSku.href}>Open {state.existingSku.label}</Link>.</>}</p>}
    {!id && <h2 className="text-sm font-semibold text-slate-800">Product Information</h2>}
    <div className="grid gap-3 sm:grid-cols-2"><div><label className="label" htmlFor="name">Name *</label><input className="field" id="name" name="name" required maxLength={200} defaultValue={initial?.name}/>{state.errors.name && <p className="text-sm text-red-700">{state.errors.name}</p>}</div><div><label className="label" htmlFor="categoryId">Product Category</label><select className="field" id="categoryId" name="categoryId" defaultValue={initial?.categoryId ?? ''}><option value="">Uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{state.errors.categoryId && <p className="text-sm text-red-700">{state.errors.categoryId}</p>}</div></div>
    {!id && <h2 className="border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">Initial SKU</h2>}
    <div className="grid gap-3 sm:grid-cols-2"><div><label className="label" htmlFor="sku">SKU / Part Number *</label><input className="field" id="sku" name="sku" required maxLength={100} defaultValue={initial?.sku}/>{state.errors.sku && <p className="text-sm text-red-700">{state.errors.sku}</p>}</div>{!id && <CatalogSourceField source={source} onChange={setSource}/>}</div>
    <div className="max-w-xs"><label className="label" htmlFor="active">Status</label><select className="field" id="active" name="active" defaultValue={initial?.active === false ? "false" : "true"}><option value="true">Active</option><option value="false">Inactive</option></select></div>
    {!id && source === 'ODM' && <section className="space-y-3 border-t border-slate-200 pt-3"><h2 className="text-sm font-semibold text-slate-800">ODM Details</h2><OdmDetailsFields/></section>}
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href="/products">Cancel</Link><button type="submit" className="btn-primary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : id ? "Save product" : "Create product"}</button></div>
  </form>;
}
