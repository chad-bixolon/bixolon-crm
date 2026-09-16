"use client";
import Link from "next/link";
import { useActionState } from "react";
import { submitProduct, type FormState } from "@/app/products/actions";
export function ProductForm({ id, initial }: { id?: number; initial?: { sku: string; name: string; active: boolean } }) {
  const [state, action, pending] = useActionState(submitProduct.bind(null, id ?? null), { errors: {} } as FormState);
  return <form action={action} className="panel max-w-2xl space-y-5 p-6" aria-label={id ? "Edit product" : "Create product"}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div><label className="label" htmlFor="sku">SKU *</label><input className="field" id="sku" name="sku" required maxLength={100} defaultValue={initial?.sku}/>{state.errors.sku && <p className="text-sm text-red-700">{state.errors.sku}</p>}</div>
    <div><label className="label" htmlFor="name">Name *</label><input className="field" id="name" name="name" required maxLength={200} defaultValue={initial?.name}/>{state.errors.name && <p className="text-sm text-red-700">{state.errors.name}</p>}</div>
    <div><label className="label" htmlFor="active">Status</label><select className="field" id="active" name="active" defaultValue={initial?.active === false ? "false" : "true"}><option value="true">Active</option><option value="false">Inactive</option></select></div>
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href="/products">Cancel</Link><button className="btn-primary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : id ? "Save product" : "Create product"}</button></div>
  </form>;
}
