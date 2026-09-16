import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function UsersPage() {
  const users = await prisma.user.findMany({ where: { archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return <Content><PageHeader eyebrow="Administration" title="Users" description="Manage CRM record owners and roles." action={<Link className="btn-primary" href="/administration/users/new">New user</Link>}/><div className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-4">Name</th><th className="px-5 py-4">Email</th><th className="px-5 py-4">Role</th><th className="px-5 py-4">Status</th></tr></thead><tbody className="divide-y">{users.map((user) => <tr key={user.id}><td className="px-5 py-4"><Link className="font-medium text-orange-800" href={`/administration/users/${user.id}/edit`}>{user.firstName} {user.lastName}</Link></td><td className="px-5 py-4">{user.email}</td><td className="px-5 py-4">{user.role.replaceAll("_", " ")}</td><td className="px-5 py-4">{user.active ? "Active" : "Inactive"}</td></tr>)}</tbody></table>{!users.length && <p className="p-8 text-center text-sm text-slate-500">No CRM users yet. Create one to assign account and opportunity owners.</p>}</div></Content>;
}
