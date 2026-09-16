import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { UserForm } from "@/components/user-form";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const user = await prisma.user.findUnique({ where: { id } }); if (!user || user.archivedAt) notFound();
  return <Content><PageHeader eyebrow="Administration / Users" title={`Edit ${user.firstName} ${user.lastName}`}/><UserForm id={id} initial={user}/></Content>;
}
