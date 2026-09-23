import { Content, PageHeader } from "@/components/shell";
import { ContactForm } from "@/components/contact-form";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/current-user";
import { can } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  const actor = await currentUser();
  const accounts = await prisma.account.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const accountId = Number((await searchParams).accountId);
  return <Content><PageHeader eyebrow="Contacts" title="New contact"/><ContactForm accounts={accounts} accountId={Number.isSafeInteger(accountId) && accountId > 0 ? accountId : undefined} canEditMarketingPreference={can(actor,"marketing.write")}/></Content>;
}
