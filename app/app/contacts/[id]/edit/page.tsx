import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ContactForm } from "@/components/contact-form";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/current-user";
import { can } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const actor = await currentUser();
  const [contact, accounts] = await Promise.all([prisma.contact.findUnique({ where: { id } }), prisma.account.findMany({ where: { status: "ACTIVE", archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  if (!contact) notFound(); return <Content><PageHeader eyebrow="Contacts" title={`Edit ${contact.firstName} ${contact.lastName}`}/>{contact.archivedAt ? <div className="panel p-6">Reactivate this contact before editing it.</div> : <ContactForm id={id} initial={contact} accounts={accounts} canEditMarketingPreference={can(actor,"marketing.write")}/>}</Content>;
}
