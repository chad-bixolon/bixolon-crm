import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { assertSnapshotAdmin, snapshotWeek } from '@/lib/opportunity-snapshots';
import { WEEKLY_SNAPSHOT_JOB, WEEKLY_SNAPSHOT_CADENCE } from '@/lib/weekly-snapshots';
import { formatEasternDateTime } from '@/lib/display-format';
import type { Actor } from '@/lib/authorization';

export async function WeeklySnapshotStatus({ actor }: { actor: Actor }) {
  assertSnapshotAdmin(actor);
  const now = new Date();
  const currentWeekDate = snapshotWeek(now);
  const [completed, runs] = await Promise.all([prisma.scheduledJobRun.findFirst({ where: { jobType: WEEKLY_SNAPSHOT_JOB, snapshotWeek: currentWeekDate, status: 'SUCCEEDED' }, select: { id: true } }), prisma.scheduledJobRun.findMany({ where: { jobType: WEEKLY_SNAPSHOT_JOB }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: 8,
    include: { forecastSnapshotRun: { select: { year: true, quarter: true } } } })]);
  const currentWeek = currentWeekDate.toISOString().slice(0, 10);
  const renderAttempt = (run: (typeof runs)[number], latest = false) => <li key={run.id} className="break-words py-3 text-sm">
      {latest ? 'Last automated capture attempt' : 'Automated capture attempt'} #{run.id} · {formatEasternDateTime(run.startedAt)} Eastern · Week of {run.snapshotWeek?.toISOString().slice(0, 10)} · <strong>{run.status === 'RUNNING' && now.getTime() - run.startedAt.getTime() > 10 * 60000 ? 'Interrupted or overdue — retry safely' : run.status}</strong>
      {run.completedAt && <span> · Completed {formatEasternDateTime(run.completedAt)} Eastern</span>}
      <div>{run.opportunitySnapshotRunId ? <Link className="underline" href={`/reports/opportunity-snapshots?after=${run.opportunitySnapshotRunId}`}>Opportunity Snapshot #{run.opportunitySnapshotRunId}</Link> : 'Opportunity Snapshot unavailable'} · {run.forecastSnapshotRunId ? <Link className="underline" href={`/reports/forecast-snapshots?after=${run.forecastSnapshotRunId}&year=${run.forecastSnapshotRun?.year}&quarter=${run.forecastSnapshotRun?.quarter}`}>Forecast Snapshot #{run.forecastSnapshotRunId}</Link> : 'Forecast Snapshot unavailable'}</div>
      {run.failureCategory && <p>{run.failureCategory}: {run.errorSummary}</p>}{run.resultSummary && <p>{run.resultSummary}</p>}
    </li>;
  return <section aria-label="Weekly snapshot automation" className="panel mb-5 min-w-0 p-5">
    <h2 className="mb-2 text-lg font-semibold">Weekly snapshot automation</h2>
    <p className="text-sm">Expected cadence: {WEEKLY_SNAPSHOT_CADENCE}. Scheduling must be configured in production.</p>
    <p className="mt-2 text-sm">Week of {currentWeek}: {completed ? 'completed' : 'no successful automated execution recorded'}. <Link className="underline" href="/administration/system-health">System Health</Link></p>
    {runs.length ? <>
      <ul className="mt-3">{renderAttempt(runs[0], true)}</ul>
      {runs.length > 1 && <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Earlier automation attempts ({runs.length - 1})</summary><ul className="mt-2 divide-y">{runs.slice(1).map(run => renderAttempt(run))}</ul></details>}
    </> : <p className="mt-3 text-sm text-slate-600">No automated captures recorded. Manual capture remains available below.</p>}
  </section>;
}
