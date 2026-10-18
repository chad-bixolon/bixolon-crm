import { AdminAuditPage } from '@/components/admin-audit-page';
import type { AuditFilters } from '@/lib/admin-audit';
import type { IntegrationFilters } from '@/lib/admin-integration-history';
import { AdminIntegrationHistoryPage } from '@/components/admin-integration-history';
export const dynamic = 'force-dynamic';
export default async function MaintenanceHistory({ searchParams }: { searchParams: Promise<AuditFilters & IntegrationFilters & { view?: string }> }) {
  const filters = await searchParams;
  return filters.view === 'integrations' ? <AdminIntegrationHistoryPage filters={filters}/> : <AdminAuditPage filters={filters} maintenance/>;
}
