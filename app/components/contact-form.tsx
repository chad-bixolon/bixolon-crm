"use client";
import { useSubmitGuard } from "@/lib/submit-guard";
import Link from "next/link";
import { useActionState } from "react";
import { submitContact, type FormState } from "@/app/contacts/actions";
import { AddressFields } from "@/components/address-fields";
import type { Address } from "@/lib/address";
type Initial = Address & { accountId: number | null; firstName: string; lastName: string; title: string | null; email: string | null; phone: string | null; mobile: string | null; active: boolean; isPrimary: boolean };
export function ContactForm({ id, initial, accounts, accountId }: { id?: number; initial?: Initial; accounts: { id: number; name: string }[]; accountId?: number }) {
  const [state, action, pending] = useActionState(submitContact.bind(null, id ?? null), { errors: {} } as FormState);
  const guard = useSubmitGuard(state);
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  return <form action={action} onSubmit={guard} className="panel max-w-4xl p-6" aria-label={id ? "Edit contact" : "Create contact"}>
    {state.message && <p role="alert" className="mb-5 rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="accountId">Account (optional)</label><select className="field" name="accountId" id="accountId" defaultValue={initial?.accountId ?? accountId ?? ""}><option value="">No account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}{initial?.accountId && !accounts.some((a) => a.id === initial.accountId) && <option value={initial.accountId}>Current account (inactive)</option>}</select>{error("accountId")}</div>
      {([ ["firstName", "First name"], ["lastName", "Last name"], ["title", "Title"], ["email", "Email"], ["phone", "Office phone"], ["mobile", "Mobile phone"] ] as const).map(([key, label]) => <div key={key}><label className="label" htmlFor={key}>{label}{key === "firstName" || key === "lastName" ? " *" : ""}</label><input className="field" id={key} name={key} type={key === "email" ? "email" : key === "phone" || key === "mobile" ? "tel" : "text"} required={key === "firstName" || key === "lastName"} maxLength={key === "email" ? 254 : key === "title" ? 200 : key === "phone" || key === "mobile" ? 50 : 100} defaultValue={initial?.[key] ?? ""}/>{error(key)}</div>)}
      <div><label className="label" htmlFor="active">Status</label><select className="field" id="active" name="active" defaultValue={initial?.active === false ? "false" : "true"}><option value="true">Active</option><option value="false">Inactive</option></select></div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="isPrimary" defaultChecked={initial?.isPrimary} className="accent-orange-700"/>Primary contact for selected account</label>{error("isPrimary")}
      <AddressFields initial={initial} errors={state.errors}/>
    </div><div className="mt-7 flex justify-end gap-2"><Link href={id ? `/contacts/${id}` : "/contacts"} className="btn-secondary">Cancel</Link><button type="submit" className="btn-primary disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : id ? "Save contact" : "Create contact"}</button></div>
  </form>;
}
