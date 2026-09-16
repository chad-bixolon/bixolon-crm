"use client";
import { useActionState } from "react";
import Link from "next/link";
import { AccountBusinessRoleCode, AccountStatus } from "@prisma/client";
import { roleLabels } from "@/lib/account-validation";
import { submitAccount, type FormState } from "@/app/accounts/actions";

type Option = { code: string; name: string };
type Owner = { id: number; firstName: string; lastName: string };
type Initial = { name: string; status: AccountStatus; strategicAccount: boolean; industry: string | null; territory: string | null; ownerId: number | null; website: string | null; phone: string | null; roles: AccountBusinessRoleCode[] };
export function AccountForm({ id, initial, industries, territories, owners }: { id?: number; initial?: Initial; industries: Option[]; territories: Option[]; owners: Owner[] }) {
  const [state, action, pending] = useActionState(submitAccount.bind(null, id ?? null), { errors: {} } as FormState);
  const error = (key: string) => state.errors[key] && <p id={`${key}-error`} className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  return <form action={action} className="panel max-w-4xl p-6 lg:p-8" aria-label={id ? "Edit account" : "Create account"}>
    {state.message && <p role="alert" className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="name">Account name <span aria-hidden="true">*</span></label><input className="field" id="name" name="name" required maxLength={200} defaultValue={initial?.name} aria-invalid={!!state.errors.name} aria-describedby={state.errors.name ? "name-error" : undefined}/>{error("name")}</div>
      <div><label className="label" htmlFor="status">Status</label><select className="field" id="status" name="status" defaultValue={initial?.status ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>{error("status")}</div>
      <div><label className="label" htmlFor="ownerId">Owner</label><select className="field" id="ownerId" name="ownerId" defaultValue={initial?.ownerId ?? ""}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}</select>{error("ownerId")}{owners.length === 0 && <p className="mt-1 text-xs text-slate-500">No active users available.</p>}</div>
      <fieldset className="sm:col-span-2"><legend className="label">Business roles</legend><div className="flex flex-wrap gap-x-6 gap-y-3">{Object.entries(roleLabels).map(([code, label]) => <label key={code} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="roles" value={code} defaultChecked={initial?.roles.includes(code as AccountBusinessRoleCode)} className="accent-orange-700"/>{label}</label>)}</div>{error("roles")}</fieldset>
      <div><label className="label" htmlFor="territory">Territory</label><select className="field" id="territory" name="territory" defaultValue={initial?.territory ?? ""}><option value="">None selected</option>{territories.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}{initial?.territory && !territories.some((o) => o.code === initial.territory) && <option value={initial.territory}>{initial.territory} (inactive)</option>}</select>{error("territory")}</div>
      <div><label className="label" htmlFor="industry">Industry</label><select className="field" id="industry" name="industry" defaultValue={initial?.industry ?? ""}><option value="">None selected</option>{industries.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}{initial?.industry && !industries.some((o) => o.code === initial.industry) && <option value={initial.industry}>{initial.industry} (inactive)</option>}</select>{error("industry")}</div>
      <div><label className="label" htmlFor="website">Website</label><input className="field" id="website" name="website" type="url" maxLength={500} placeholder="https://example.com" defaultValue={initial?.website ?? ""} aria-invalid={!!state.errors.website}/>{error("website")}</div>
      <div><label className="label" htmlFor="phone">Phone</label><input className="field" id="phone" name="phone" type="tel" maxLength={50} defaultValue={initial?.phone ?? ""} aria-invalid={!!state.errors.phone}/>{error("phone")}</div>
      <label className="flex items-center gap-3 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" name="strategicAccount" defaultChecked={initial?.strategicAccount} className="accent-orange-700"/>Strategic account</label>
    </div>
    <div className="mt-8 flex justify-end gap-3"><Link className="btn-secondary" href={id ? `/accounts/${id}` : "/accounts"}>Cancel</Link><button className="btn-primary disabled:opacity-60" type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Create account"}</button></div>
  </form>;
}
