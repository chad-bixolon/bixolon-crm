import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { currentUser } from '@/lib/current-user';
import { randomUUID } from 'crypto';
import { defaultEligibleUserId } from '@/lib/assignment-eligibility';
import { caseWorkContext } from '@/lib/support-work';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { validatedWorkPrefill } from '@/lib/work-prefill';
import { assertWorkPermission } from '@/lib/support-work';
import { defaultActivityType } from '@/lib/activity-quality';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string;contactId?:string;supportCaseId?:string}>}) {
  const p=await searchParams, actor=await currentUser(), caseId=Number(p.supportCaseId);
  if (p.supportCaseId && (!Number.isSafeInteger(caseId)||caseId<1)) notFound();
  if (actor.role==='SUPPORT' && !p.supportCaseId) notFound();
  const supportCase=p.supportCaseId ? await caseWorkContext(prisma,actor,caseId) : null;
  assertWorkPermission(actor, supportCase?.id ?? null);
  const prefill=supportCase ? {} : await validatedWorkPrefill(p,actor,true);
  const contactId=Number(p.contactId);
  const linkedContactIds=supportCase?.contactId?[supportCase.contactId]:prefill.contactId?[contactId]:[];
  const options=await workOptions({accountId:supportCase?.accountId ?? prefill.accountId,opportunityId:prefill.opportunityId,projectId:prefill.projectId,supportCaseId:supportCase?.id,contactIds:linkedContactIds});
  if (actor.role==='SUPPORT') { options.opportunities=[]; options.projects=[]; }
  return <Content><PageHeader title="New activity" eyebrow={supportCase?NAV_CATEGORIES.support:NAV_CATEGORIES.sales}/><WorkForm kind="activity" cancelHref={supportCase ? `/support/cases/${supportCase.id}` : prefill.contactId ? `/contacts/${prefill.contactId}` : prefill.opportunityId ? `/opportunities/${prefill.opportunityId}` : prefill.projectId ? `/projects/${prefill.projectId}` : prefill.accountId ? `/accounts/${prefill.accountId}` : `/`} createKey={randomUUID()} {...options} supportCase={supportCase?{id:supportCase.id,caseNumber:supportCase.caseNumber,contactName:supportCase.contact?`${supportCase.contact.firstName} ${supportCase.contact.lastName}`:null}:undefined} lockAccountId={supportCase?.accountId ?? undefined} linkedContactIds={linkedContactIds} initial={{accountId:supportCase?.accountId??prefill.accountId??'',opportunityId:prefill.opportunityId??'',projectId:prefill.projectId??'',userId:defaultEligibleUserId(options.users,actor.id),activityDate:new Date().toISOString().slice(0,16),direction:'NA',type:defaultActivityType(options.activityTypes)}}/></Content>;
}
