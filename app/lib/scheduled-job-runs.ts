import type { PrismaClient } from '@prisma/client';

export const JOB_CADENCE = {
  NOTIFICATION_EVALUATOR: { label: 'Notification Evaluator', staleAfterMs: 48 * 60 * 60 * 1000 },
  WEEKLY_SNAPSHOTS: { label: 'Weekly Opportunity + Forecast Snapshots', staleAfterMs: 8 * 24 * 60 * 60 * 1000 },
  CALENDAR_SYNC: { label: 'Calendar Sync', staleAfterMs: 60 * 60 * 1000 },
} as const;
export type JobType = keyof typeof JOB_CADENCE;
export type JobState = 'Healthy' | 'Stale' | 'Failed';

export function jobState(latest: { status: string; startedAt: Date; completedAt: Date | null } | null, type: JobType, now = new Date()): JobState {
  if (!latest) return 'Stale';
  if (latest.status === 'FAILED') return 'Failed';
  return latest.status === 'SUCCEEDED' && latest.completedAt && now.getTime() - latest.completedAt.getTime() <= JOB_CADENCE[type].staleAfterMs ? 'Healthy' : 'Stale';
}

/** Monitoring must never prevent the underlying authorized job from running. */
export async function beginJobRun(db: PrismaClient, jobType: JobType) {
  try { return await db.scheduledJobRun.create({ data: { jobType, status: 'RUNNING' }, select: { id: true } }); }
  catch { return null; }
}

export async function finishJobRun(db: PrismaClient, id: number | undefined, result: { status: 'SUCCEEDED' | 'FAILED'; processedCount?: number; createdCount?: number; resolvedCount?: number; resultSummary?: string; errorSummary?: string }) {
  if (!id) return;
  try {
    await db.scheduledJobRun.update({ where: { id }, data: { completedAt: new Date(), status: result.status, processedCount: result.processedCount, createdCount: result.createdCount, resolvedCount: result.resolvedCount, resultSummary: result.resultSummary?.slice(0, 300), errorSummary: result.errorSummary?.slice(0, 300) } });
  } catch { /* The job response remains governed by its own result. */ }
}

/** Complete monitoring independently of the job response, even if the start write is slow. */
export function recordJobResult(db: PrismaClient, run: Promise<{ id: number } | null>, result: Parameters<typeof finishJobRun>[2]) {
  void run.then(created => finishJobRun(db, created?.id, result)).catch(() => { /* Monitoring is best effort. */ });
}
