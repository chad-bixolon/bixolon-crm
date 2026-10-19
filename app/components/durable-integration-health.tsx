import Link from 'next/link';
import type { Actor } from '@/lib/authorization';
import { prisma } from '@/lib/prisma';
import { durableIntegrationHealth, safeAttemptFailure } from '@/lib/admin-integration-history';
import { integrationLabels } from '@/lib/integration-attempts';
import { formatEasternDateTime } from '@/lib/display-format';

export async function DurableIntegrationHealth({ actor }: { actor: Actor }) {
  let health;
  try { health = await durableIntegrationHealth(prisma, actor); }
  catch { return <section className="panel mt-5 p-5"><h2 className="font-semibold">Integration &amp; Job History unavailable</h2><p className="mt-2 text-sm">Connection and job history could not be loaded. Ask the system administrator to check the database connection.</p></section>; }
  const date = (value?: Date | null) => value ? formatEasternDateTime(value) : 'Not recorded';
  return <section aria-label="Recorded integration status" className="panel mt-5 p-4 sm:p-5"><h2 className="text-lg font-semibold">Integration &amp; Job History</h2><p className="mt-1 text-sm text-slate-600">Review the latest connection actions and jobs. A successful action confirms it completed at the time shown; it does not confirm the connection is working now.</p><div className="mt-4 grid gap-4 lg:grid-cols-3">{health.map(item => <article className="min-w-0 border-t pt-3 text-sm" key={item.jobType}><h3 className="font-semibold">{integrationLabels[item.jobType]}</h3><p className="mt-2">Last attempt: {date(item.latest?.startedAt)}{item.latest ? ` · ${item.latest.state}` : ''}</p><p className="mt-2">Last successful {item.jobType === 'CALENDAR_CONNECTION_SYNC' ? 'sync' : item.jobType === 'WEEKLY_SNAPSHOTS' ? 'run' : 'action'}: {date(item.successful?.completedAt)}</p>{item.failed ? <p className="mt-2 text-red-800">Most recent unresolved failure: {date(item.failed.startedAt)} · {safeAttemptFailure(item.failed.failureCategory)}</p> : <p className="mt-2 text-slate-600">No unresolved failures recorded.</p>}<Link className="mt-3 inline-block text-orange-800 underline" href={`/administration/maintenance-history?view=integrations&integration=${item.jobType}`}>Review history</Link></article>)}</div></section>;
}
