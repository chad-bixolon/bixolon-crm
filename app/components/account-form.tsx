"use client";
import { useSubmitGuard } from "@/lib/submit-guard";
import { useActionState } from "react";
import Link from "next/link";
import { AccountBusinessRoleCode, AccountStatus } from "@prisma/client";
import { roleLabels } from "@/lib/account-validation";
import type { LabelMap } from "@/lib/configuration";
import { AddressFields } from "@/components/address-fields";
import type { Address } from "@/lib/address";
import { submitAccount, type FormState } from "@/app/accounts/actions";
import { createAccountForTradeShowLead } from "@/app/trade-shows/[id]/leads/[leadId]/resolve/actions";

type Option = { code: string; name: string; active?: boolean };
type Owner = { id: number; firstName: string; lastName: string };
type Initial = Address & { name: string; status: AccountStatus; strategicAccount: boolean; industry: string | null; territory: string | null; ownerId: number | null; website: string | null; phone: string | null; roles: AccountBusinessRoleCode[] };
export function AccountForm({ id, initial, industries, territories, owners, currentOwner, labels, leadContext, defaultOwnerId }: { id?: number; initial?: Initial; industries: Option[]; territories: Option[]; owners: Owner[]; currentOwner?: {firstName:string;lastName:string}|null; labels?: LabelMap; leadContext?: {tradeShowId:number;leadId:number}; defaultOwnerId?: number | null }) {
  const submit = leadContext ? createAccountForTradeShowLead.bind(null,leadContext.tradeShowId,leadContext.leadId) : submitAccount.bind(null, id ?? null);
  const [state, action, pending] = useActionState(submit, { errors: {} } as FormState);
  const guard = useSubmitGuard(state, action);
  const values = state.values ?? initial;
  const error = (key: string) => state.errors[key] && <p id={`${key}-error`} className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  return <form action={action} onSubmit={guard} className="panel max-w-4xl p-6 lg:p-8" aria-label={id ? "Edit account" : "Create account"}>
    {state.message && <p role="alert" className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    {state.matches?.length ? <section className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" role="alert">
      <h2 className="font-semibold">{state.matches.length === 1 ? 'Possible duplicate Account found' : 'Possible duplicate Accounts found'}</h2>
      <p className="mt-1">{state.matches.length === 1 ? 'We found an existing Account with the same name. Please review it before creating a new one.' : 'We found existing Accounts that may match this company. Review them before creating a new Account.'}</p>
      <ul className="mt-3 space-y-1">{state.matches.map(match => <li key={match.id}><Link className="font-medium text-orange-800 underline" href={`/accounts/${match.id}`} target="_blank">Open {match.name}</Link>{match.archived ? ' (archived)' : ''}</li>)}</ul>
      <p className="mt-2">If this is a different company, you can still continue and create a new Account.</p>
    </section> : null}
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="name">Account name <span aria-hidden="true">*</span></label><input className="field" id="name" name="name" required maxLength={200} defaultValue={values?.name} aria-invalid={!!state.errors.name} aria-describedby={state.errors.name ? "name-error" : undefined}/>{error("name")}</div>
      <div><label className="label" htmlFor="status">Status</label><select className="field" id="status" name="status" defaultValue={values?.status ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>{error("status")}</div>
      <div><label className="label" htmlFor="ownerId">Owner</label><select className="field" id="ownerId" name="ownerId" defaultValue={values?.ownerId ?? (!id ? defaultOwnerId : null) ?? ""}><option value="">Unassigned</option>{id && initial?.ownerId && !owners.some((o) => o.id === initial.ownerId) && <optgroup label="Current assignment"><option value={initial.ownerId}>{currentOwner ? `${currentOwner.firstName} ${currentOwner.lastName}` : 'User'} (no longer eligible)</option></optgroup>}{owners.map((o) => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}</select>{error("ownerId")}{owners.length === 0 && <p className="mt-1 text-xs text-slate-500">No eligible owners. Add one in Administration → Users, or leave unassigned.</p>}</div>
      <fieldset className="sm:col-span-2 rounded-md border border-slate-200 p-4"><legend className="px-1 text-sm font-semibold text-slate-800">Business Roles</legend><div className="flex flex-wrap gap-x-6 gap-y-3">{Object.entries(roleLabels).map(([code, label]) => <label key={code} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="roles" value={code} defaultChecked={values?.roles.includes(code as AccountBusinessRoleCode)} className="accent-orange-700"/>{labels?.[code as keyof LabelMap] ?? label}</label>)}</div>{error("roles")}</fieldset>
      <div><label className="label" htmlFor="territory">Territory</label><select className="field" id="territory" name="territory" defaultValue={values?.territory ?? ""}><option value="">None selected</option>{territories.map((o) => <option key={o.code} value={o.code}>{o.name}{o.active === false ? " (inactive)" : ""}</option>)}{values?.territory && !territories.some((o) => o.code === values.territory) && <option value={values.territory}>{values.territory} (inactive)</option>}</select><p className="mt-1 text-xs text-slate-500">Sales coverage for this Account.</p>{error("territory")}</div>
      <div><label className="label" htmlFor="industry">Industry</label><select className="field" id="industry" name="industry" defaultValue={values?.industry ?? ""}><option value="">None selected</option>{industries.map((o) => <option key={o.code} value={o.code}>{o.name}{o.active === false ? " (inactive)" : ""}</option>)}{values?.industry && !industries.some((o) => o.code === values.industry) && <option value={values.industry}>{values.industry} (inactive)</option>}</select>{error("industry")}</div>
      <div><label className="label" htmlFor="website">Website</label><input className="field" id="website" name="website" type="url" maxLength={500} placeholder="https://example.com" defaultValue={values?.website ?? ""} aria-invalid={!!state.errors.website}/>{error("website")}</div>
      <div><label className="label" htmlFor="phone">Phone</label><input className="field" id="phone" name="phone" type="tel" maxLength={50} defaultValue={values?.phone ?? ""} aria-invalid={!!state.errors.phone}/>{error("phone")}</div>
      <label className="sm:col-span-2"><span className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" name="strategicAccount" defaultChecked={values?.strategicAccount} className="accent-orange-700"/>{labels?.STRATEGIC_ACCOUNT ?? "Strategic Account"}</span><span className="mt-1 block text-xs font-normal text-slate-500">Identifies an Account requiring strategic or national-level attention.</span></label>
      <AddressFields initial={values} errors={state.errors}/>
    </div>
    <div className="mt-8 flex justify-end gap-3"><Link className="btn-secondary" href={leadContext ? `/trade-shows/${leadContext.tradeShowId}/leads/${leadContext.leadId}/edit` : id ? `/accounts/${id}` : "/accounts"}>Cancel</Link><button className="btn-primary disabled:opacity-60" type="submit" name={state.matches?.length ? "reviewedDuplicates" : undefined} value={state.reviewToken} disabled={pending}>{pending ? "Saving…" : state.matches?.length ? "Save anyway" : id ? "Save changes" : "Create account"}</button></div>
  </form>;
}
