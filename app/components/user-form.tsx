"use client";
import { useSubmitGuard } from "@/lib/submit-guard";
import Link from "next/link";
import { useActionState } from "react";
import { UserRole } from "@prisma/client";
import { submitUser, type FormState } from "@/app/administration/users/actions";
import { roleLabels } from "@/lib/role-labels";
export function UserForm({ id, initial, created = false }: { id?: number; initial?: { firstName: string; lastName: string; email: string; role: UserRole; active: boolean }; created?: boolean }) {
  const [state, action, pending] = useActionState(submitUser.bind(null, id ?? null), { errors: {} } as FormState);
  const guard = useSubmitGuard(state);
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  const value = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  const valueKey = state.values ? "submitted" : "initial";
  return <form action={action} onSubmit={guard} className="panel max-w-2xl space-y-5 p-6" aria-label={id ? "Edit user" : "Create user"}>
    {created && !state.message && <p role="status" className="rounded bg-green-50 p-3 text-sm text-green-800">User created successfully.</p>}
    {state.message && <p role={state.success ? "status" : "alert"} className={`rounded p-3 text-sm ${state.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{state.message}</p>}
    <div className="grid gap-5 sm:grid-cols-2"><div><label className="label" htmlFor="firstName">First name *</label><input key={valueKey} className="field" id="firstName" name="firstName" required maxLength={100} defaultValue={value("firstName", initial?.firstName ?? "")}/>{error("firstName")}</div><div><label className="label" htmlFor="lastName">Last name *</label><input key={valueKey} className="field" id="lastName" name="lastName" required maxLength={100} defaultValue={value("lastName", initial?.lastName ?? "")}/>{error("lastName")}</div></div>
    <div><label className="label" htmlFor="email">Email *</label><input key={valueKey} className="field" id="email" name="email" type="email" required maxLength={320} defaultValue={value("email", initial?.email ?? "")}/>{error("email")}</div>
    <div><label className="label" htmlFor="role">Role *</label><select key={valueKey} className="field" id="role" name="role" defaultValue={value("role", initial?.role ?? UserRole.SALES)}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>{error("role")}</div>
    <div><label className="label" htmlFor="active">Status</label><select key={valueKey} className="field" id="active" name="active" defaultValue={value("active", initial?.active === false ? "false" : "true")}><option value="true">Active</option><option value="false">Inactive</option></select>{error("active")}</div>
    <p className="text-sm text-slate-500">User records identify owners. Sign-in and passwords are not configured here.</p>
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href="/administration/users">Cancel</Link><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : id ? "Save user" : "Create user"}</button></div>
  </form>;
}
