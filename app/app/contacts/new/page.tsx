import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import { Content, PageHeader } from "@/components/shell";
import { ContactForm } from "@/components/contact-form";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/current-user";
import { notFound } from "next/navigation";
import { positiveId } from "@/lib/crm-validation";
export const dynamic = "force-dynamic";
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  await requirePermission("contacts.write");
  const rawAccountId = (await searchParams).accountId;
  const accountId = rawAccountId ? positiveId(rawAccountId) : null;
  const accounts = accountId ? await prisma.account.findMany({ where: { id: accountId, status: "ACTIVE", archivedAt: null }, select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, stateProvince: true, postalCode: true, country: true } }) : [];
  if (rawAccountId && (!accountId || !accounts.length)) notFound();
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.crm} title="New contact"/><ContactForm accounts={accounts} accountId={accountId ?? undefined}/></Content>;
}
