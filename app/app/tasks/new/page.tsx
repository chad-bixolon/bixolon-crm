import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string;activityId?:string}>}) { const p=await searchParams; const options=await workOptions(); const activityId = Number(p.activityId); const activity = Number.isSafeInteger(activityId) && activityId > 0 ? await prisma.activity.findFirst({where:{id:activityId,archivedAt:null}}) : null; return <Content><PageHeader title="New task" eyebrow="Tasks" description={activity ? 'Review the prefilled follow-up and save to create the Task.' : undefined}/><WorkForm kind="task" createKey={randomUUID()} {...options} initial={{accountId:activity?.accountId??p.accountId??'',opportunityId:activity?.opportunityId??p.opportunityId??'',projectId:activity?.projectId??p.projectId??'',subject:activity?.nextStep??'',description:activity ? `Follow-up from Activity: ${activity.subject}` : '',dueDate:activity?.followUpDate?.toISOString().slice(0,10)??'',assignedToId:activity?.userId??'',status:'OPEN',priority:'NORMAL'}}/></Content>; }
