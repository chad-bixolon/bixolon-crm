import Link from 'next/link';
import { Content, PageHeader } from '@/components/shell';
import { requirePermission } from '@/lib/current-user';
import { PriceExceptionImportWorkflow } from './workflow';
export default async function PriceExceptionImportPage(){await requirePermission('users.manage');return <Content><PageHeader eyebrow="Administration → Imports" title="Price Exceptions" description="Import finalized BIXOLON commercial Price Exception records. This is not an approval workflow." action={<Link className="btn-secondary" href="/administration/imports">All imports</Link>}/><PriceExceptionImportWorkflow/></Content>}
