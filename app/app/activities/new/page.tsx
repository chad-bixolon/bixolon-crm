import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { currentUser } from '@/lib/current-user';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string}>}) { const p=await searchParams; const [options, actor]=await Promise.all([workOptions(),currentUser()]); return <Content><PageHeader title="New activity" eyebrow="Activities"/><WorkForm kind="activity" {...options} initial={{accountId:p.accountId??'',opportunityId:p.opportunityId??'',projectId:p.projectId??'',userId:actor.id,activityDate:new Date().toISOString().slice(0,16),direction:'NA'}}/></Content>; }
