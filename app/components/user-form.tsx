"use client";
import Link from "next/link";
import { useActionState } from "react";
import { UserRole } from "@prisma/client";
import { submitUser, type FormState } from "@/app/administration/users/actions";
const roles: Record<UserRole, string> = { ADMIN: "Administrator", SALES_MANAGER: "Sales manager", SALES: "Sales", READ_ONLY: "Read only" };
export function UserForm({ id, initial }: { id?: number; initial?: { firstName: string; lastName: string; email: string; role: UserRole; active: boolean } }) {
  const [state, action, pending] = useActionState(submitUser.bind(null, id ?? null), { errors: {} } as FormState);
  const error = (key: string) => state.errors[key] && <p className="mt-1 text-sm text-red-700">{state.errors[key]}</p>;
  return <form action={action} className="panel max-w-2xl space-y-5 p-6" aria-label={id ? "Edit user" : "Create user"}>
    {state.message && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>}
    <div className="grid gap-5 sm:grid-cols-2"><div><label className="label" htmlFor="firstName">First name *</label><input className="field" id="firstName" name="firstName" required maxLength={100} defaultValue={initial?.firstName}/>{error("firstName")}</div><div><label className="label" htmlFor="lastName">Last name *</label><input className="field" id="lastName" name="lastName" required maxLength={100} defaultValue={initial?.lastName}/>{error("lastName")}</div></div>
    <div><label className="label" htmlFor="email">Email *</label><input className="field" id="email" name="email" type="email" required maxLength={320} defaultValue={initial?.email}/>{error("email")}</div>
    <div><label className="label" htmlFor="role">Role *</label><select className="field" id="role" name="role" defaultValue={initial?.role ?? UserRole.SALES}>{Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>{error("role")}</div>
    <div><label className="label" htmlFor="active">Status</label><select className="field" id="active" name="active" defaultValue={initial?.active === false ? "false" : "true"}><option value="true">Active</option><option value="false">Inactive</option></select>{error("active")}</div>
    <p className="text-sm text-slate-500">User records identify owners. Sign-in and passwords are not configured here.</p>
    <div className="flex justify-end gap-2"><Link className="btn-secondary" href="/administration/users">Cancel</Link><button className="btn-primary" disabled={pending}>{pending ? "Saving…" : id ? "Save user" : "Create user"}</button></div>
  </form>;
}
