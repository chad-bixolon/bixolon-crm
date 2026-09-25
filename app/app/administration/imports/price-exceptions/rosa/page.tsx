import Link from 'next/link';
import { Content,PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { RosaImportWorkflow } from './workflow';
export default async function RosaImportPage(){const actor=await requirePermission('users.manage');if(actor.role!=='ADMIN')return <Content><p>Administrator access required.</p></Content>;return <Content><PageHeader eyebrow="Administration → Imports" title="Rosa Price Exception CSV" description="Preview the exact 16-column export and import only READY rows after confirmation." action={<Link className="btn-secondary" href="/administration/imports/price-exceptions">Legacy workbook</Link>}/><RosaImportWorkflow/></Content>}
