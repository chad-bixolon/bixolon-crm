import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { currentUser } from '@/lib/current-user';
import { randomUUID } from 'crypto';
import { defaultEligibleUserId } from '@/lib/assignment-eligibility';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string;contactId?:string}>}) { const p=await searchParams; const [options, actor]=await Promise.all([workOptions(),currentUser()]); const contactId=Number(p.contactId); const linkedContactIds=Number.isSafeInteger(contactId)&&contactId>0?[contactId]:[]; return <Content><PageHeader title="New activity" eyebrow={NAV_CATEGORIES.sales}/><WorkForm kind="activity" createKey={randomUUID()} {...options} linkedContactIds={linkedContactIds} initial={{accountId:p.accountId??'',opportunityId:p.opportunityId??'',projectId:p.projectId??'',userId:defaultEligibleUserId(options.users,actor.id),activityDate:new Date().toISOString().slice(0,16),direction:'NA'}}/></Content>; }
