import Link from 'next/link';
import { Content,PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { accountOptions } from '@/lib/accounts';
import { prisma } from '@/lib/prisma';
import { RosaImportWorkflow } from './workflow';
export default async function RosaImportPage(){const actor=await requirePermission('users.manage');if(actor.role!=='ADMIN')return <Content><p>Administrator access required.</p></Content>;const options=await accountOptions(prisma);return <Content><PageHeader eyebrow="Administration → Imports" title="Import Price Exceptions" description="Upload a Price Exception CSV to preview and validate the records before importing them." action={<Link className="btn-secondary" href="/administration/imports/price-exceptions">Legacy workbook</Link>}/><RosaImportWorkflow accountOptions={{industries:options.industries.map(x=>({code:x.code,name:x.name})),territories:options.territories.map(x=>({code:x.code,name:x.name}))}}/></Content>}
