import { NAV_CATEGORIES } from '@/lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { caseWorkContext } from '@/lib/support-work';
import { currentUser } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string;supportCaseId?:string}>}) {
  const p=await searchParams, actor=await currentUser(), caseId=Number(p.supportCaseId);
  if (p.supportCaseId && (!Number.isSafeInteger(caseId)||caseId<1)) notFound();
  if (actor.role==='SUPPORT' && !p.supportCaseId) notFound();
  const supportCase=p.supportCaseId ? await caseWorkContext(prisma,actor,caseId) : null;
  const options=await workOptions({supportCaseId:supportCase?.id});
  if (actor.role==='SUPPORT') { options.opportunities=[]; options.projects=[]; }
  return <Content><PageHeader title="New note" eyebrow={supportCase?NAV_CATEGORIES.support:NAV_CATEGORIES.sales}/><WorkForm kind="note" {...options} supportCase={supportCase?{id:supportCase.id,caseNumber:supportCase.caseNumber,contactName:supportCase.contact?`${supportCase.contact.firstName} ${supportCase.contact.lastName}`:null}:undefined} lockAccountId={supportCase?.accountId} initial={{accountId:supportCase?.accountId??p.accountId??'',opportunityId:supportCase?'':p.opportunityId??'',projectId:supportCase?'':p.projectId??''}}/></Content>;
}
