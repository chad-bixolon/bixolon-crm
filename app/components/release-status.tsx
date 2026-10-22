import Link from 'next/link';
import { Prisma } from '@prisma/client';
import type { Actor } from '@/lib/authorization';
import { assertAdmin } from '@/lib/admin-maintenance';
import { prisma } from '@/lib/prisma';
import { releaseStatus, readManifest, jobSummary, gmailStatus, type Manifest } from '@/lib/release-status';
import { durableIntegrationHealth, safeAttemptFailure } from '@/lib/admin-integration-history';
import { connectionStatus, supportGmailClientConfigured } from '@/lib/support-gmail-connection';
import { formatEasternDateTime } from '@/lib/display-format';
const date = (value?: Date | string | null) => value ? formatEasternDateTime(new Date(value)) : 'Not recorded';
// Presentation only: these labels translate the existing verification results.
export function DeploymentStatus({ release, manifest }: { release: Awaited<ReturnType<typeof releaseStatus>>; manifest: Manifest | null }) {
  const summaries: Record<string, string> = {
    Verified: 'SalesHub is running the expected application and database versions.',
    'Attention needed': 'The application or database needs attention. Review the checks below and share Technical details with your system maintainer.',
    'Partially verified': 'Some deployment checks passed, but SalesHub could not confirm every required check. Review the unverified items below.',
    'Unable to verify': 'SalesHub could not confirm the deployed application and database versions. Ask your system maintainer to review Technical details.',
  };
  const databaseLabels: Record<string, string> = { 'Up to date': 'Current', 'Migration pending': 'Pending', 'Migration failed': 'Failed' };
  const compatibility = release.runtime === 'Verified' ? 'Verified' : release.runtime === 'Attention needed'
    ? 'Attention needed — the application and database versions do not match. Contact your system maintainer.'
    : 'Unable to verify — compatibility could not be confirmed. Contact your system maintainer.';
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Deployment Status</h2><span className={`rounded px-2 py-1 text-sm font-medium ${release.overall === 'Verified' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{release.overall}</span></div>
    <p className="mt-2 text-sm">{summaries[release.overall] ?? summaries['Unable to verify']}</p>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Deployed version', release.commit?.slice(0, 10) ?? 'Unable to verify'], ['Source branch', release.branch ?? 'Not recorded'], ['Deployed', date(release.builtAt)], ['SalesHub version', release.version ?? 'Unable to verify'],
        ['Database updates', databaseLabels[release.migrations.status] ?? 'Unable to verify'], ['Application & database compatibility', compatibility], ['Last checked', date(release.checkedAt)],
      ].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium" title={label === 'Deployed version' ? release.commit ?? undefined : undefined}>{value}</dd></div>)}
    </dl>
    <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium text-orange-800">Technical details</summary>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
        {[
          ['Full commit SHA', release.commit ?? 'Unable to verify'], ['Build commit SHA', manifest?.commit && /^[a-f0-9]{40}$/i.test(manifest.commit) ? manifest.commit : 'Not recorded'], ['Build time', date(release.builtAt)], ['Build application version', release.version ?? 'Unable to verify'], ['Metadata format', manifest?.format?.toString() ?? 'Unable to verify'],
          ['Migration status', release.migrations.status], ['Migration counts', `${release.migrations.expected ?? 'Unknown'} expected · ${release.migrations.applied ?? 'Unknown'} applied · ${release.migrations.failed ?? 'Unknown'} failed`],
          ['Prisma runtime/schema status', release.runtime], ['Expected Prisma client version', manifest?.prismaVersion ?? 'Unable to verify'], ['Running Prisma client/runtime version', Prisma.prismaVersion.client], ['Expected source schema SHA-256', manifest?.schemaHash ?? 'Unable to verify'], ['Expected normalized schema fingerprint', manifest?.normalizedSchemaHash ?? 'Unable to verify'],
        ].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
      </dl>
      <p className="mt-3 text-slate-600">Deployed uses the recorded build time; the actual deployment time is not recorded. Runtime identity does not change build metadata. Verification requires a known commit, current migration history, and matching Prisma client/runtime versions and source, generated, and embedded schema evidence. Migration history does not prove the absence of manual database drift.</p>
      <p className="mt-2"><Link className="text-orange-800 underline" href="/help/system-health">System Health Help</Link> explains how to review these checks. Maintainers can consult <code>app/docs/system-health.md</code> for verification rules and <code>npm run release:check</code> for the pre-deployment check.</p>
    </details>
  </>;
}

function OperationalSummary({ summary }: { summary: string }) {
  const [result, detail] = summary.split(' — ');
  const status = result === 'Last run successful' || result === 'Last run completed' ? 'Healthy' : result === 'Last run had failures' ? 'Attention needed' : result === 'Unable to verify' ? 'Unable to verify' : 'In progress or interrupted';
  return <><p className="mt-2">Status: {status}</p>{detail && <p>{detail.replace(/^(\d+) connections processed$/, (_, count) => `${count} calendar connection${count === '1' ? '' : 's'} processed`)}</p>}</>;
}

export async function ReleaseStatus({ actor }: { actor: Actor }) {
  assertAdmin(actor);
  const [release, history, weekly, calendar, calendarSuccess, gmail] = await Promise.all([
    releaseStatus(prisma, actor), durableIntegrationHealth(prisma, actor).catch(() => null),
    prisma.scheduledJobRun.findFirst({ where: { jobType: 'WEEKLY_SNAPSHOTS', isTest: false }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], select: { status: true, startedAt: true, failureCategory: true, opportunitySnapshotRunId: true, forecastSnapshotRunId: true, forecastSnapshotRun: { select: { year: true, quarter: true } } } }).catch(() => null),
    prisma.scheduledJobRun.findFirst({ where: { jobType: 'CALENDAR_SYNC', isTest: false }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], select: { status: true, startedAt: true, resultSummary: true } }).catch(() => null),
    prisma.scheduledJobRun.findFirst({ where: { jobType: 'CALENDAR_SYNC', isTest: false, status: 'SUCCEEDED', completedAt: { not: null } }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }], select: { completedAt: true } }).catch(() => null),
    gmailStatus(supportGmailClientConfigured(), () => connectionStatus(prisma)),
  ]);
  const snapshotHistory = history?.find(h => h.jobType === 'WEEKLY_SNAPSHOTS');
  const gmailHistory = history?.find(h => h.jobType === 'SUPPORT_GMAIL');
  return <section aria-label="Deployment Status" className="panel mb-5 min-w-0 p-4 sm:p-5">
    <DeploymentStatus release={release} manifest={readManifest()}/>
    <div className="mt-4 grid gap-4 border-t pt-4 text-sm lg:grid-cols-3">
      <article className="min-w-0"><h3 className="font-semibold">Weekly Sales Snapshots</h3><OperationalSummary summary={jobSummary(weekly)}/>{weekly?.status !== 'SUCCEEDED' && <p>{weekly?.status === 'FAILED' ? 'Latest failed attempt' : 'Latest attempt'}: {date(weekly?.startedAt)}</p>}<p>{weekly?.status === 'SUCCEEDED' ? 'Last completed' : 'Most recent successful completion'}: {date(snapshotHistory?.successful?.completedAt)}</p>
        <p className="mt-1">{weekly?.opportunitySnapshotRunId ? <Link className="underline" href={`/reports/opportunity-snapshots?after=${weekly.opportunitySnapshotRunId}`}>Latest Opportunity Snapshot #{weekly.opportunitySnapshotRunId}</Link> : 'Opportunity Snapshot not recorded'}</p>
        <p>{weekly?.forecastSnapshotRunId ? <Link className="underline" href={`/reports/forecast-snapshots?after=${weekly.forecastSnapshotRunId}&year=${weekly.forecastSnapshotRun?.year}&quarter=${weekly.forecastSnapshotRun?.quarter}`}>Latest Forecast Snapshot #{weekly.forecastSnapshotRunId}</Link> : 'Forecast Snapshot not recorded'}</p>
        {weekly?.status === 'FAILED' && <p className="mt-1 text-amber-900">{safeAttemptFailure(weekly.failureCategory)}</p>}
      </article>
      <article className="min-w-0"><h3 className="font-semibold">Calendar Automation</h3><OperationalSummary summary={jobSummary(calendar, true)}/>{calendar?.status !== 'SUCCEEDED' && <p>{calendar?.status === 'FAILED' ? 'Latest failed attempt' : 'Latest attempt'}: {date(calendar?.startedAt)}</p>}<p>{calendar?.status === 'SUCCEEDED' ? 'Last completed' : 'Most recent successful completion'}: {date(calendarSuccess?.completedAt)}</p><p className="mt-1 text-slate-600">Per-connection results are shown below and in Integration &amp; Job History.</p></article>
      <article className="min-w-0"><h3 className="font-semibold">Support Email Connection</h3><p className="mt-2">Status: {gmailHistory?.failed ? 'Attention needed' : gmail === 'Configured · connection recorded' ? 'Healthy' : gmail === 'Configured · not connected' ? 'Attention needed' : gmail === 'Not configured' ? 'Not configured' : 'Unable to verify'}</p><p>{gmail === 'Configured · connection recorded' ? 'Gmail connected' : gmail === 'Configured · not connected' ? 'Gmail not connected — reconnect from Support inbox.' : gmail === 'Not configured' ? 'Gmail not configured' : 'Unable to verify Gmail connection'}</p><p>Last successful activity: {date(gmailHistory?.successful?.completedAt)}</p>{gmailHistory?.failed ? <p className="mt-1 text-amber-900">Latest unresolved error: {date(gmailHistory.failed.startedAt)} · {safeAttemptFailure(gmailHistory.failed.failureCategory)}</p> : <p>{history ? 'No unresolved errors' : 'Activity history unavailable.'}</p>}</article>
    </div>
    <p className="mt-4 text-sm text-slate-600">SalesHub checks that the deployed application matches the expected database version and that required database updates have been applied. The operational checks below show whether scheduled services have been running successfully. Recorded activity confirms what completed at the time shown; it does not confirm live provider availability.</p>
    <p className="mt-2 text-sm"><Link className="text-orange-800 underline" href="/administration/maintenance-history?view=integrations">Review Integration &amp; Job History</Link> for errors and successful retries. For deployment checks that need attention, share Technical details with your system maintainer.</p>
    <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium text-orange-800">How deployment verification works</summary><p>Before deployment, the release check validates the code and tests. After deployment, System Health confirms that the running SalesHub version and database are compatible. These checks are read-only and do not make changes to the system.</p></details>
  </section>;
}
