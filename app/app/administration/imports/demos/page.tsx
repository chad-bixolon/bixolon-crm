import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { DemoImportWorkflow } from './workflow';
import { accountOptions } from '@/lib/accounts';
import { prisma } from '@/lib/prisma';

export default async function DemoImportPage(){const actor=await requirePermission('users.manage');if(actor.role!=='ADMIN')return <Content><p>Administrator access required.</p></Content>;const options=await accountOptions(prisma);return <Content><PageHeader eyebrow="Administration → Imports" title="Import Demo Requests" description="Upload the Rosa Demo CSV, resolve CRM matches, review lifecycle changes, and confirm the import." action={<Link className="btn-secondary" href="/administration/imports">All imports</Link>}/><p className="mb-4 text-sm text-slate-600">The Rosa CSV is the primary source. If an existing Rosa Demo was missed, <Link className="text-orange-800 underline" href="/administration/imports/demos/backfill">add an existing Rosa Demo record manually</Link>.</p><DemoImportWorkflow accountOptions={{industries:options.industries.map(x=>({code:x.code,name:x.name})),territories:options.territories.map(x=>({code:x.code,name:x.name}))}}/></Content>}
