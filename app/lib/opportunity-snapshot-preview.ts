import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SnapshotPreview } from './opportunity-snapshots';

function signature(payload: string, secret: string) {
  if (!secret) throw new Error('Snapshot preview signing is not configured.');
  return createHmac('sha256', secret).update(`opportunity-snapshot-v1:${payload}`).digest('base64url');
}
export function signSnapshotPreview(preview: SnapshotPreview, actorId: number, secret: string) {
  const payload = Buffer.from(JSON.stringify({ ...preview, actorId })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function verifySnapshotPreview(token: string, actorId: number, secret: string): SnapshotPreview {
  if (token.length > 2000) throw new Error('Invalid snapshot preview.');
  const [payload, supplied, extra] = token.split('.');
  const expected = signature(payload ?? '', secret);
  if (!payload || !supplied || extra || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error('Invalid snapshot preview.');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (value.actorId !== actorId || typeof value.preparedAt !== 'string' || typeof value.week !== 'string' || !Number.isSafeInteger(value.count) || value.count < 0 || typeof value.fingerprint !== 'string') throw new Error('Invalid snapshot preview.');
  return { preparedAt: value.preparedAt, week: value.week, count: value.count, fingerprint: value.fingerprint, ...(value.forecastReady !== undefined ? { forecastReady: value.forecastReady === true } : {}) };
}
