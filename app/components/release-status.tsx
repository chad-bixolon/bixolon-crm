import Link from 'next/link';
import type { Actor } from '@/lib/authorization';
import { assertAdmin } from '@/lib/admin-maintenance';
import { prisma } from '@/lib/prisma';
import { releaseStatus, jobSummary, gmailStatus } from '@/lib/release-status';
import { durableIntegrationHealth, safeAttemptFailure } from '@/lib/admin-integration-history';
import { connectionStatus, supportGmailClientConfigured } from '@/lib/support-gmail-connection';
import { formatEasternDateTime } from '@/lib/display-format';
const date = (value?: Date | string | null) => value ? formatEasternDateTime(new Date(value)) : 'Not recorded';
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
  return <section aria-label="Release Status" className="panel mb-5 min-w-0 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Release Status</h2><span className={`rounded px-2 py-1 text-sm font-medium ${release.overall === 'Verified' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{release.overall}</span></div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Commit', release.commit ?? 'Unable to verify'], ['Branch', release.branch ?? 'Not recorded'], ['Build time', date(release.builtAt)], ['Application version', release.version ?? 'Unable to verify'],
        ['Migration status', release.migrations.status], ['Migrations', `${release.migrations.expected ?? 'Unknown'} expected · ${release.migrations.applied ?? 'Unknown'} applied · ${release.migrations.failed ?? 'Unknown'} failed`], ['Runtime/schema status', release.runtime], ['Checked at', date(release.checkedAt)],
      ].map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
    </dl>
    <div className="mt-4 grid gap-4 border-t pt-4 text-sm lg:grid-cols-3">
      <article className="min-w-0"><h3 className="font-semibold">Weekly snapshots</h3><p className="mt-2">{jobSummary(weekly)}</p><p>Last attempt: {date(weekly?.startedAt)}</p><p>Last success: {date(snapshotHistory?.successful?.completedAt)}</p>
        <p className="mt-1">{weekly?.opportunitySnapshotRunId ? <Link className="underline" href={`/reports/opportunity-snapshots?after=${weekly.opportunitySnapshotRunId}`}>Opportunity Snapshot #{weekly.opportunitySnapshotRunId}</Link> : 'Opportunity Snapshot not recorded'}</p>
        <p>{weekly?.forecastSnapshotRunId ? <Link className="underline" href={`/reports/forecast-snapshots?after=${weekly.forecastSnapshotRunId}&year=${weekly.forecastSnapshotRun?.year}&quarter=${weekly.forecastSnapshotRun?.quarter}`}>Forecast Snapshot #{weekly.forecastSnapshotRunId}</Link> : 'Forecast Snapshot not recorded'}</p>
        {weekly?.status === 'FAILED' && <p className="mt-1 text-amber-900">{safeAttemptFailure(weekly.failureCategory)}</p>}
      </article>
      <article className="min-w-0"><h3 className="font-semibold">Calendar scheduler</h3><p className="mt-2">{jobSummary(calendar, true)}</p><p>Last attempt: {date(calendar?.startedAt)}</p><p>Last success: {date(calendarSuccess?.completedAt)}</p><p className="mt-1 text-slate-600">Per-connection results are shown below and in Integration &amp; Job History.</p></article>
      <article className="min-w-0"><h3 className="font-semibold">Support Gmail</h3><p className="mt-2">{gmail}</p><p>Last successful operation: {date(gmailHistory?.successful?.completedAt)}</p>{gmailHistory?.failed ? <p className="mt-1 text-amber-900">Latest unresolved failure: {date(gmailHistory.failed.startedAt)} · {safeAttemptFailure(gmailHistory.failed.failureCategory)}</p> : <p>{history ? 'No unresolved failures recorded.' : 'Operation history unavailable.'}</p>}</article>
    </div>
    <p className="mt-4 text-xs text-slate-600">Release verification requires a known commit, current migration history, and matching Prisma runtime/schema. Migration history does not prove the absence of manual database drift. Operational results describe recorded work, not live provider availability; inactivity does not fail release verification.</p>
    <details className="mt-2 text-sm"><summary className="cursor-pointer py-2 font-medium text-orange-800">Pre-deploy and post-deploy verification</summary><p>Pre-deploy: <code>npm run release:check</code> validates the local candidate before deployment. Post-deploy: System Health verifies what the running environment can prove. This page only reads evidence; it does not deploy or change services.</p></details>
  </section>;
}
