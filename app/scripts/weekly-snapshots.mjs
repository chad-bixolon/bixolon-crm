// A DO scheduled Job calls the web service's existing business services over
// authenticated HTTPS. Never print request headers, origins, or provider errors.
import { setTimeout as delay } from 'node:timers/promises';

try {
  const origin = new URL(process.env.SALESHUB_JOB_ORIGIN ?? '');
  const secret = process.env.WEEKLY_SNAPSHOT_SECRET ?? '';
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || secret.length < 32) throw new Error('configuration');
  let week = process.argv[2];
  if (process.argv.length > 3 || (week !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(week))) throw new Error('arguments');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(new URL('/api/internal/snapshots/weekly', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240_000),
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(week ? { week } : {}),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.status === 'SUCCEEDED') {
      console.log(`Weekly snapshots succeeded: execution #${Number(result.id)}, Opportunity #${Number(result.opportunitySnapshotRunId)}, Forecast #${Number(result.forecastSnapshotRunId)}.`);
      break;
    }
    // Only retry with the exact intended week returned by an authorized run.
    // Transport/unknown outcomes exit nonzero for operator review, never re-date.
    if (attempt === 3 || !/^\d{4}-\d{2}-\d{2}$/.test(result?.week ?? '') || !['OPPORTUNITY_CAPTURE_FAILED', 'FORECAST_CAPTURE_FAILED'].includes(result?.failureCategory)) throw new Error('execution');
    week = result.week;
    await delay(attempt * 5000);
  }
} catch {
  console.error('Weekly snapshots failed. Review Administration → Opportunity Snapshots and retry the intended Monday week date.');
  process.exitCode = 1;
}
