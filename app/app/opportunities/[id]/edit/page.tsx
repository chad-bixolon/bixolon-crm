import { notFound } from "next/navigation";
import { Content, PageHeader } from "@/components/shell";
import { OpportunityForm } from "@/components/opportunity-form";
import { opportunityOptions } from "@/lib/opportunities";
import { prisma } from "@/lib/prisma";
import { getLabels } from "@/lib/configuration";
import { currentUser } from "@/lib/current-user";
import { serializeOpportunityForForm } from "@/lib/opportunity-serialization";
export const dynamic = "force-dynamic";
export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const actor = await currentUser();
  const [opportunity, options, labels] = await Promise.all([prisma.opportunity.findUnique({ where: { id }, include: { projects: true, contacts: true, participants: { include: { roles: true } }, products: { where: { archivedAt: null }, include: { priceExceptionLine: { select: { priceException: { select: { distributorAccountId: true, varAccountId: true, endUserAccountId: true, assignedSalesRepUserId:true, sourceType:true } } } } } } } }), opportunityOptions(prisma), getLabels(prisma)]);
  if (!opportunity || (actor.role === 'SALES' && opportunity.ownerId !== actor.id)) notFound();
  if (!options.stages.some(stage => stage.id === opportunity.stageId)) {
    const currentStage = await prisma.salesStage.findUnique({ where: { id: opportunity.stageId }, select: { id: true, name: true, probability: true, isClosed: true, isWon: true } });
    if (currentStage) options.stages.push(currentStage);
  }
  if (opportunity.competitorId && !options.competitors.some(option => option.id === opportunity.competitorId)) {
    const currentCompetitor = await prisma.competitorOption.findUnique({ where: { id: opportunity.competitorId }, select: { id: true, name: true, active: true } });
    if (currentCompetitor) options.competitors.push(currentCompetitor);
  }
  const initial = serializeOpportunityForForm(opportunity, actor);
  return <Content><PageHeader eyebrow="Opportunities" title={`Edit ${opportunity.name}`}/>{opportunity.archivedAt ? <div className="panel p-6">Reactivate this opportunity before editing it.</div> : <OpportunityForm key={id} id={id} initial={initial} {...options} owners={actor.role === 'SALES' ? options.owners.filter(owner => owner.id === actor.id) : options.owners} labels={labels}/>}</Content>;
}
