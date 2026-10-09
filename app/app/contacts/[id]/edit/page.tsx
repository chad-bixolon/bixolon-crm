import { NAV_CATEGORIES } from '../../../../lib/navigation-categories';
import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { ContactForm } from "@/components/contact-form";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  await requirePermission("contacts.write");
  const contact = await prisma.contact.findUnique({ where: { id } });
  const accounts = contact?.accountId ? await prisma.account.findMany({ where: { id: contact.accountId }, select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, stateProvince: true, postalCode: true, country: true } }) : [];
  if (!contact) notFound(); return <Content><PageHeader eyebrow={NAV_CATEGORIES.crm} title={`Edit ${contact.firstName} ${contact.lastName}`}/>{contact.archivedAt ? <div className="panel p-6">Reactivate this contact before editing it.</div> : <ContactForm id={id} initial={contact} accounts={accounts}/>}</Content>;
}
