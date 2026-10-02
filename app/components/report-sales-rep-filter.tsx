import type { Actor } from '@/lib/authorization';

type Rep = { id: number; firstName: string; lastName: string };

export function showReportSalesRepFilter(actor: Actor, reps: readonly Rep[]) {
  return actor.role !== 'SALES' && reps.length > 1;
}

export function ReportSalesRepFilter({ actor, reps, selected = '', label = 'Sales Rep' }: {
  actor: Actor; reps: readonly Rep[]; selected?: string; label?: string;
}) {
  if (!showReportSalesRepFilter(actor, reps)) {
    // Keep an existing saved filter on submit; the report query still enforces actor scope.
    return selected ? <input type="hidden" name="ownerId" value={selected} /> : null;
  }
  return <label className="label">{label}<select className="field" name="ownerId" defaultValue={selected}>
    <option value="">All available Sales Reps</option>
    {reps.map(rep => <option key={rep.id} value={rep.id}>{rep.firstName} {rep.lastName}</option>)}
  </select></label>;
}
