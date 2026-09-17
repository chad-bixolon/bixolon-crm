import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
import { prisma } from "@/lib/prisma";
import { roleLabels } from "@/lib/role-labels";
export const dynamic = "force-dynamic";
export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await prisma.user.findUnique({ where: { id } }); if (!user) notFound();
  const created = (await searchParams).saved === "created";
  return <Content><PageHeader eyebrow="Administration / Users" title={`${user.archivedAt ? 'Archived' : 'Edit'} ${user.firstName} ${user.lastName}`}/>{user.archivedAt ? <div className="panel space-y-3 p-6"><span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span><p className="text-sm">{user.email} · {roleLabels[user.role]}</p><p className="text-sm">This user is archived and cannot be edited.</p></div> : <UserForm id={id} initial={user} created={created}/>}</Content>;
}
