import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { readDocumentStorageConfig } from './document-storage-config';
import { JOB_CADENCE, jobState, type JobType } from './scheduled-job-runs';

type TableMetric = { name: string; size: string; approximateRows: number };
type IndexMetric = { name: string; table: string; size: string };

export async function databaseHealth(db: PrismaClient) {
  try {
    const [identity, tables, indexes, migrations] = await Promise.all([
      db.$queryRaw<{ name: string; version: string; size: string }[]>`SELECT current_database() AS name, current_setting('server_version') AS version, pg_size_pretty(pg_database_size(current_database())) AS size`,
      db.$queryRaw<{ name: string; size: string; approximateRows: bigint }[]>`SELECT relname AS name, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS "approximateRows" FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5`,
      db.$queryRaw<IndexMetric[]>`SELECT indexrelname AS name, relname AS "table", pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 5`,
      db.$queryRaw<{ applied: bigint; failed: bigint }[]>`SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied, count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed FROM _prisma_migrations`,
    ]);
    return { status: Number(migrations[0]?.failed ?? 0) > 0 ? 'Problem' as const : 'Healthy' as const, connected: true, name: identity[0]?.name ?? 'Unknown', version: identity[0]?.version ?? 'Unknown', size: identity[0]?.size ?? 'Unknown', tables: tables.map(row => ({ ...row, approximateRows: Number(row.approximateRows) })) as TableMetric[], indexes, migrations: { applied: Number(migrations[0]?.applied ?? 0), failed: Number(migrations[0]?.failed ?? 0) } };
  } catch { return { status: 'Problem' as const, connected: false, name: null, version: null, size: null, tables: [] as TableMetric[], indexes: [] as IndexMetric[], migrations: null }; }
}

export async function objectStorageHealth() {
  let config;
  try { config = readDocumentStorageConfig(); }
  catch (error) { return { status: error instanceof Error && error.message === 'Document storage is not configured.' ? 'Not configured' as const : 'Problem' as const }; }
  const client = new S3Client({ region: config.region, endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  try { await client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: AbortSignal.timeout(5000) }); return { status: 'Healthy' as const }; }
  catch { return { status: 'Problem' as const }; }
  finally { client.destroy(); }
}

export async function scheduledJobHealth(db: PrismaClient, now = new Date()) {
  try {
    return await Promise.all((Object.keys(JOB_CADENCE) as JobType[]).map(async type => {
      const [latest, successful] = await Promise.all([
        db.scheduledJobRun.findFirst({ where: { jobType: type }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
        db.scheduledJobRun.findFirst({ where: { jobType: type, status: 'SUCCEEDED' }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }] }),
      ]);
      return { type, label: JOB_CADENCE[type].label, state: jobState(latest, type, now), latest, successful, staleAfterMs: JOB_CADENCE[type].staleAfterMs };
    }));
  } catch { return (Object.keys(JOB_CADENCE) as JobType[]).map(type => ({ type, label: JOB_CADENCE[type].label, state: 'Stale' as const, latest: null, successful: null, staleAfterMs: JOB_CADENCE[type].staleAfterMs })); }
}
