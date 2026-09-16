import { Content, PageHeader } from '@/components/shell';
import { WorkForm } from '@/components/work-form';
import { workOptions } from '@/lib/work-options';
import { randomUUID } from 'node:crypto';
export const dynamic = 'force-dynamic';
export default async function Page({searchParams}: {searchParams: Promise<{accountId?:string;opportunityId?:string}>}) { const p=await searchParams; const options=await workOptions(); return <Content><PageHeader title="New task" eyebrow="Tasks"/><WorkForm kind="task" createKey={randomUUID()} {...options} initial={{accountId:p.accountId??'',opportunityId:p.opportunityId??'',status:'OPEN',priority:'NORMAL'}}/></Content>; }
