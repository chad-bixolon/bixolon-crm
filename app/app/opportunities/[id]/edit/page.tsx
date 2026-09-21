import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { currentUser } from "@/lib/current-user";
import { canViewPriceException } from "@/lib/price-exception-visibility";
export const dynamic = "force-dynamic";
export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const actor = await currentUser();
  const [opportunity, options, labels] = await Promise.all([prisma.opportunity.findUnique({ where: { id }, include: { projects: true, participants: { include: { roles: true } }, products: { where: { archivedAt: null }, include: { priceExceptionLine: { select: { priceException: { select: { distributorAccountId: true, varAccountId: true, endUserAccountId: true, assignedSalesRepUserId:true, sourceType:true } } } } } } } }), opportunityOptions(prisma), getLabels(prisma)]);
  if (!opportunity) notFound();
  if (!options.stages.some(stage => stage.id === opportunity.stageId)) {
    const currentStage = await prisma.salesStage.findUnique({ where: { id: opportunity.stageId } });
    if (currentStage) options.stages.push(currentStage);
  }
  const initial = { ...opportunity, projectIds: opportunity.projects.map(link => link.projectId), participants: opportunity.participants.map((p) => ({ accountId: p.accountId, roles: p.roles.map((r) => r.role) })), lines: opportunity.products.map((line) => ({ id: line.id, productId: line.productId, skuId: line.skuId, quantity: line.quantity, price: line.estimatedUnitPrice.toFixed(2), priceSource: line.priceSource, catalogPriceTier: line.catalogPriceTier, priceExceptionLineId: line.priceExceptionLineId, priceExceptionCode: line.priceExceptionCode, priceExceptionUnitPrice: line.priceExceptionUnitPrice?.toFixed(2) ?? null, priceExceptionCurrencyCode: line.priceExceptionCurrencyCode, priceExceptionSourceQty: line.priceExceptionSourceQty, priceExceptionAccountIds: line.priceExceptionLine&&canViewPriceException(actor,line.priceExceptionLine.priceException) ? [line.priceExceptionLine.priceException.distributorAccountId, line.priceExceptionLine.priceException.varAccountId, line.priceExceptionLine.priceException.endUserAccountId].filter((accountId): accountId is number => accountId !== null) : [] })) };
  return <Content><PageHeader eyebrow="Opportunities" title={`Edit ${opportunity.name}`}/>{opportunity.archivedAt ? <div className="panel p-6">Reactivate this opportunity before editing it.</div> : <OpportunityForm key={id} id={id} initial={initial} {...options} labels={labels}/>}</Content>;
}
