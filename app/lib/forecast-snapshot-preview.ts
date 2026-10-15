import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ForecastPreview } from './forecast-snapshots';
import { quarterBounds } from './business-quarter';
function signature(payload: string, secret: string) {
  if (!secret) throw new Error('Forecast preview signing is not configured.');
  return createHmac('sha256', secret).update(`forecast-snapshot-v1:${payload}`).digest('base64url');
}
export function signForecastPreview(preview: ForecastPreview, actorId: number, secret: string) {
  const payload = Buffer.from(JSON.stringify({ ...preview, actorId })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function verifyForecastPreview(token: string, actorId: number, secret: string): ForecastPreview {
  if (typeof token !== 'string' || token.length > 2000) throw new Error('Invalid forecast preview.');
  const [payload, supplied, extra] = token.split('.');
  const expected = signature(payload ?? '', secret);
  if (!payload || !supplied || extra || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error('Invalid forecast preview.');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (value.actorId !== actorId || !Number.isSafeInteger(value.sourceRunId) || value.sourceRunId <= 0 || typeof value.preparedAt !== 'string') throw new Error('Invalid forecast preview.');
  quarterBounds(value.year, value.quarter);
  return { sourceRunId: value.sourceRunId, year: value.year, quarter: value.quarter, preparedAt: value.preparedAt };
}
