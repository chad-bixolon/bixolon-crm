import type { PrismaClient } from '@prisma/client';
import { businessQuarter } from './business-quarter';
import { captureOpportunitySnapshot, previewOpportunitySnapshot, snapshotWeek, FORECAST_SNAPSHOT_SCOPE } from './opportunity-snapshots';
import { captureForecastSnapshot, previewForecastSnapshot } from './forecast-snapshots';
import { weeklySnapshotService } from './snapshot-capture-identity';

export const WEEKLY_SNAPSHOT_JOB = 'WEEKLY_SNAPSHOTS';
export const WEEKLY_SNAPSHOT_CADENCE = 'Mondays at 5:00 a.m. America/New_York';
const failures = {
  OPPORTUNITY_CAPTURE_FAILED: 'Opportunity capture did not complete. Retry the intended week.',
  INCOMPATIBLE_SOURCE: 'This week has an open-only or incompatible Opportunity Snapshot. It cannot be replaced or used for forecast capture. Admin review required.',
  MISSING_HISTORICAL_SOURCE: 'No Opportunity Snapshot exists for this past week. Historical live data cannot be reconstructed.',
  FORECAST_CAPTURE_FAILED: 'Forecast capture did not complete. The Opportunity Snapshot is preserved. Retry the intended week.',
} as const;
type Failure = keyof typeof failures;

export function intendedSnapshotWeek(value: string | undefined, now: Date) {
  const current = snapshotWeek(now);
  if (value === undefined) return current;
  const week = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(week.getTime()) || week.toISOString().slice(0, 10) !== value || week.getUTCDay() !== 1 || week > current) throw new Error('Choose a current or past Monday week date.');
  return week;
}

/** Each invocation has durable operational history. Snapshot uniqueness, rather
 * than a process lock or a RUNNING flag, arbitrates concurrent/restarted jobs. */
export async function runWeeklySnapshots(db: PrismaClient, weekKey?: string) {
  const [{ at }] = await db.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
  const week = intendedSnapshotWeek(weekKey, at);
  const attempt = await db.scheduledJobRun.create({ data: { jobType: WEEKLY_SNAPSHOT_JOB, status: 'RUNNING', snapshotWeek: week } });
  let failure: Failure = 'OPPORTUNITY_CAPTURE_FAILED';
  let sourceId: number | null = null;
  let forecastId: number | null = null;
  let created = 0;
  try {
    let source = await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: week } });
    if (!source) {
      if (week.getTime() !== snapshotWeek(at).getTime()) { failure = 'MISSING_HISTORICAL_SOURCE'; throw new Error(failure); }
      try {
        const preview = await previewOpportunitySnapshot(db, weeklySnapshotService, true);
        // A process crossing Monday midnight must never capture the new week
        // on behalf of an invocation intended for the previous week.
        if (preview.week !== week.toISOString().slice(0, 10)) throw new Error('Week changed');
        source = await captureOpportunitySnapshot(db, weeklySnapshotService, preview, true);
        created++;
      } catch {
        // A concurrent manual/job capture may have won the existing unique key.
        source = await db.opportunitySnapshotRun.findUnique({ where: { snapshotWeek: week } });
        if (!source) throw new Error(failure);
      }
    }
    sourceId = source.id;
    await db.scheduledJobRun.update({ where: { id: attempt.id }, data: { opportunitySnapshotRunId: sourceId } });
    if (source.status !== 'COMPLETE' || source.scopeVersion !== FORECAST_SNAPSHOT_SCOPE) { failure = 'INCOMPATIBLE_SOURCE'; throw new Error(failure); }
    failure = 'FORECAST_CAPTURE_FAILED';
    // Freeze rollover semantics to the exact immutable source, even on later retries.
    const period = businessQuarter(source.snapshotAt);
    const key = { sourceRunId: source.id, ...period };
    let forecast = await db.forecastSnapshotRun.findUnique({ where: { sourceRunId_year_quarter: key } });
    if (!forecast) {
      try {
        const { preview } = await previewForecastSnapshot(db, weeklySnapshotService, key);
        forecast = await captureForecastSnapshot(db, weeklySnapshotService, preview, true);
        created++;
      } catch {
        forecast = await db.forecastSnapshotRun.findUnique({ where: { sourceRunId_year_quarter: key } });
        if (!forecast) throw new Error(failure);
      }
    }
    if (forecast.status !== 'COMPLETE' || forecast.rulesVersion !== 'QUARTERLY_V1' || forecast.sourceRunId !== source.id || forecast.year !== period.year || forecast.quarter !== period.quarter || forecast.snapshotAt.getTime() !== source.snapshotAt.getTime()) throw new Error(failure);
    forecastId = forecast.id;
    return await db.scheduledJobRun.update({ where: { id: attempt.id }, data: {
      status: 'SUCCEEDED', completedAt: new Date(), opportunitySnapshotRunId: sourceId, forecastSnapshotRunId: forecastId,
      createdCount: created, resultSummary: `${period.year} ${period.quarter}: Opportunity #${sourceId}, Forecast #${forecastId}. ${created ? 'Missing captures completed.' : 'Existing weekly captures reused.'}`,
    } });
  } catch {
    return await db.scheduledJobRun.update({ where: { id: attempt.id }, data: {
      status: 'FAILED', completedAt: new Date(), opportunitySnapshotRunId: sourceId, forecastSnapshotRunId: forecastId,
      createdCount: created, failureCategory: failure, errorSummary: failures[failure],
    } });
  }
}
