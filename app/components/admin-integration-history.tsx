import { FilterDisclosure } from '@/components/filter-disclosure';
import { countActiveFilters } from '@/lib/filter-count';
import { HelpLink } from '@/components/help-link';
import Link from 'next/link';
import { Content, PageHeader } from './shell';
import { requirePermission } from '@/lib/current-user';
import { prisma } from '@/lib/prisma';
import { adminIntegrationHistory, attemptStatuses, normalizeIntegrationFilters, safeFailureDetail, safeFailureLabel, type IntegrationFilters, type IntegrationRow } from '@/lib/admin-integration-history';
import { integrationLabels, operationLabels } from '@/lib/integration-attempts';
import { formatEasternDateTime } from '@/lib/display-format';

export function AttemptLinks({ row }: { row: IntegrationRow }) {
  return <div className="mt-2 flex flex-wrap gap-3 text-sm">
    {row.supportCaseId && <Link className="text-orange-800 underline" href={`/support/cases/${row.supportCaseId}`}>Support Case #{row.supportCaseId}</Link>}
    {row.calendarConnectionId && <span>Calendar connection #{row.calendarConnectionId}</span>}
    {row.opportunitySnapshotRunId && <Link className="text-orange-800 underline" href={`/administration/opportunity-snapshots?snapshot=${row.opportunitySnapshotRunId}#snapshot-${row.opportunitySnapshotRunId}`}>Opportunity Snapshot #{row.opportunitySnapshotRunId}</Link>}
    {row.forecastSnapshotRunId && <Link className="text-orange-800 underline" href={`/administration/forecast-snapshots?snapshot=${row.forecastSnapshotRunId}#snapshot-${row.forecastSnapshotRunId}`}>Forecast Snapshot #{row.forecastSnapshotRunId}</Link>}
    {row.recoveryId && <Link className="text-orange-800 underline" href={`/administration/maintenance-history?view=integrations&attempt=${row.recoveryId}#attempt-${row.recoveryId}`}>Recovered by attempt #{row.recoveryId}</Link>}
  </div>;
}
export async function AdminIntegrationHistoryPage({ filters: raw }: { filters: IntegrationFilters }) {
  const actor = await requirePermission('configuration.manage');
  const filters = normalizeIntegrationFilters(raw);
  const [result, users] = await Promise.all([adminIntegrationHistory(prisma, actor, filters), prisma.user.findMany({ select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } })]);
  const activeCount = countActiveFilters(filters);
  const base = '/administration/maintenance-history?view=integrations';
  function href(page: number) { const params = new URLSearchParams({ view: 'integrations', ...filters, page: String(page) }); return `/administration/maintenance-history?${params}`; }
  return <Content><PageHeader eyebrow="Administration" title="Integration &amp; Job History" description="Review connection actions and scheduled job results." action={<Link className="btn-secondary" href="/administration/system-health">System Health</Link>}/>
    <nav className="mb-4 flex flex-wrap gap-4 text-sm"><Link className="text-orange-800 underline" href="/administration/maintenance-history">Maintenance History</Link><span aria-current="page">Integration &amp; Job History</span></nav><div className="mb-3"><HelpLink topic="maintenance-history">Help with Integration &amp; Job History</HelpLink></div>
    <p className="mb-4 text-sm text-slate-600">Failed means no later successful retry has completed the same action for the same connection or record. Recovered keeps the failure and links to the successful retry. A Running entry without a completion time may have been interrupted. Viewing history does not contact Google or run jobs.</p>
    {filters.attempt && <p className="mb-4 text-sm">Showing attempt #{filters.attempt}. <Link className="text-orange-800 underline" href={base}>View full history</Link></p>}
    <form key={JSON.stringify(filters)} method="get" className="panel filter-panel responsive-filter-form mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"><FilterDisclosure initialCount={activeCount} clearHref={base}/><input type="hidden" name="view" value="integrations"/>
      <div><label className="label" htmlFor="integration">Integration or job</label><select className="field" id="integration" name="integration" defaultValue={filters.integration ?? ''}><option value="">All integrations and jobs</option>{Object.entries(integrationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div><label className="label" htmlFor="status">Status</label><select className="field" id="status" name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{attemptStatuses.map(state => <option key={state}>{state}</option>)}</select></div>
      <div><label className="label" htmlFor="actor">Performed by</label><select className="field" id="actor" name="actor" defaultValue={filters.actor ?? ''}><option value="">All users and services</option><option value="system">Automated job</option>{users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></div>
      <div><label className="label" htmlFor="from">From date (UTC)</label><input className="field" type="date" id="from" name="from" defaultValue={filters.from}/></div><div><label className="label" htmlFor="to">Through date (UTC)</label><input className="field" type="date" id="to" name="to" defaultValue={filters.to}/></div><div className="flex items-end gap-3"><button className="btn-primary">Apply filters</button><Link className="btn-secondary" href={base}>Clear filters</Link></div><p className="text-xs text-slate-600 sm:col-span-2 lg:col-span-3">Date filters use UTC boundaries; timestamps display Eastern time.</p>
    </form>
    <section aria-label="Integration attempts" className="space-y-3">{result.rows.map(row => <article id={`attempt-${row.id}`} className="panel min-w-0 scroll-mt-5 p-4" key={row.id}>
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{integrationLabels[row.jobType as keyof typeof integrationLabels]} · {Object.hasOwn(operationLabels, row.operation) ? operationLabels[row.operation as keyof typeof operationLabels] : 'Run job'}</h2><span className={`rounded px-2 py-1 text-xs ${row.state === 'Failed' ? 'bg-red-50 text-red-800' : row.state === 'Running' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{row.state}</span></div>
      <p className="mt-1 break-words text-sm text-slate-600">Attempt #{row.id} · {row.actor}{row.isTest ? ' · Test fixture' : ''}</p><p className="mt-1 text-xs text-slate-600">Started {formatEasternDateTime(row.startedAt)} · {row.completedAt ? `Completed ${formatEasternDateTime(row.completedAt)}` : 'Completion not recorded'}</p>
      {row.snapshotWeek && <p className="mt-2 text-sm">Snapshot week: {row.snapshotWeek.toISOString().slice(0, 10)}</p>}
      {(row.state === 'Failed' || row.state === 'Recovered') && <p className="mt-2 text-sm"><strong>{safeFailureLabel(row.failureCategory)}:</strong> {safeFailureDetail(row.failureCategory)}</p>}
      {(row.state === 'Failed' || row.state === 'Recovered') && row.jobType === 'CALENDAR_CONNECTION_SYNC' && <p className="mt-2 text-sm text-slate-600">Some events may have been saved. Retry resumes from the last completed sync.</p>}
      {row.recoveredAt && <p className="mt-2 text-sm">Recovered {formatEasternDateTime(row.recoveredAt)}</p>}<AttemptLinks row={row}/>
    </article>)}{!result.rows.length && <p className="panel p-5 text-sm">{activeCount ? 'No connection actions or jobs match these filters. Clear filters or choose another date range.' : 'No connection actions or job results have been recorded yet.'}</p>}</section>
    <nav aria-label="Integration history pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{result.count} entries · Page {result.page} of {result.pages}</span>{result.page > 1 && <Link className="btn-secondary" href={href(result.page - 1)}>Previous</Link>}{result.page < result.pages && <Link className="btn-secondary" href={href(result.page + 1)}>Next</Link>}</nav>
  </Content>;
}
