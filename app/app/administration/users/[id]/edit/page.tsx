import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await prisma.user.findUnique({ where: { id } }); if (!user) notFound();
  return <Content><PageHeader eyebrow="Administration / Users" title={`${user.archivedAt ? 'Archived' : 'Edit'} ${user.firstName} ${user.lastName}`}/>{user.archivedAt ? <div className="panel space-y-3 p-6"><span className="inline-block rounded bg-slate-100 px-3 py-1 text-sm font-semibold">Archived</span><p className="text-sm">{user.email} · {user.role.replaceAll('_',' ')}</p><p className="text-sm">This user is archived and cannot be edited.</p></div> : <UserForm id={id} initial={user}/>}</Content>;
}
