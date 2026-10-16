import { AdminAuditPage } from '@/components/admin-audit-page';
import type { AuditFilters } from '@/lib/admin-audit';
export const dynamic = 'force-dynamic';
export default async function AuditHistory({ searchParams }: { searchParams: Promise<AuditFilters> }) { return <AdminAuditPage filters={await searchParams}/>; }
