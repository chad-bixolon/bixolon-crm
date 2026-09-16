import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const [opportunity, options] = await Promise.all([prisma.opportunity.findUnique({ where: { id }, include: { participants: { include: { roles: true } }, products: { where: { archivedAt: null } } } }), opportunityOptions(prisma)]);
  if (!opportunity) notFound();
  const initial = { ...opportunity, participants: opportunity.participants.map((p) => ({ accountId: p.accountId, roles: p.roles.map((r) => r.role) })), lines: opportunity.products.map((line) => ({ id: line.id, productId: line.productId, quantity: line.quantity, price: line.estimatedUnitPrice.toFixed(2) })) };
  return <Content><PageHeader eyebrow="Opportunities" title={`Edit ${opportunity.name}`}/>{opportunity.archivedAt ? <div className="panel p-6">Reactivate this opportunity before editing it.</div> : <OpportunityForm key={id} id={id} initial={initial} {...options}/>}</Content>;
}
