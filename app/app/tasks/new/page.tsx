import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/current-user';
import { defaultEligibleUserId } from '@/lib/assignment-eligibility';
import { caseWorkContext } from '@/lib/support-work';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string;activityId?:string;supportCaseId?:string}>}) {
  const p=await searchParams, actor=await currentUser(), caseId=Number(p.supportCaseId);
  if (p.supportCaseId && (!Number.isSafeInteger(caseId)||caseId<1)) notFound();
  if (actor.role==='SUPPORT' && !p.supportCaseId) notFound();
  const supportCase=p.supportCaseId ? await caseWorkContext(prisma,actor,caseId) : null;
  const activityId=Number(p.activityId);
  const activity=!supportCase && Number.isSafeInteger(activityId)&&activityId>0 ? await prisma.activity.findFirst({where:{id:activityId,archivedAt:null}}) : null;
  const options=await workOptions({accountId:supportCase?.accountId ?? activity?.accountId ?? (Number(p.accountId) || undefined),opportunityId:activity?.opportunityId ?? (Number(p.opportunityId) || undefined),projectId:activity?.projectId ?? (Number(p.projectId) || undefined),supportCaseId:supportCase?.id,contactIds:supportCase?.contactId?[supportCase.contactId]:[]});
  if (actor.role==='SUPPORT') { options.opportunities=[]; options.projects=[]; }
  return <Content><PageHeader title="New task" eyebrow={supportCase?NAV_CATEGORIES.support:NAV_CATEGORIES.sales} description={activity?'Review the prefilled follow-up and save to create the Task.':undefined}/><WorkForm kind="task" createKey={randomUUID()} {...options} supportCase={supportCase?{id:supportCase.id,caseNumber:supportCase.caseNumber,contactName:supportCase.contact?`${supportCase.contact.firstName} ${supportCase.contact.lastName}`:null}:undefined} lockAccountId={supportCase?.accountId ?? undefined} initial={{accountId:supportCase?.accountId??activity?.accountId??p.accountId??'',opportunityId:supportCase?'':activity?.opportunityId??p.opportunityId??'',projectId:supportCase?'':activity?.projectId??p.projectId??'',contactId:supportCase?.contactId??'',subject:supportCase?`Follow up on ${supportCase.caseNumber}`:activity?.nextStep??'',description:activity?`Follow-up from Activity: ${activity.subject}`:'',dueDate:activity?.followUpDate?.toISOString().slice(0,10)??'',assignedToId:defaultEligibleUserId(options.users,actor.id,activity?.userId),status:'OPEN',priority:'NORMAL'}}/></Content>;
}
