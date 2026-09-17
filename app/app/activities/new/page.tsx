import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string;projectId?:string}>}) { const p=await searchParams; const options=await workOptions(); return <Content><PageHeader title="New activity" eyebrow="Activities"/><WorkForm kind="activity" {...options} initial={{accountId:p.accountId??'',opportunityId:p.opportunityId??'',projectId:p.projectId??'',activityDate:new Date().toISOString().slice(0,10)}}/></Content>; }
