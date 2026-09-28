import { Content, PageHeader } from "@/components/shell";
import { ContactForm } from "@/components/contact-form";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  await requirePermission("contacts.write");
  const accounts = await prisma.account.findMany({ where: { status: "ACTIVE", archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const accountId = Number((await searchParams).accountId);
  return <Content><PageHeader eyebrow="Contacts" title="New contact"/><ContactForm accounts={accounts} accountId={Number.isSafeInteger(accountId) && accountId > 0 ? accountId : undefined}/></Content>;
}
