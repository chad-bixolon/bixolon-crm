import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { RecordChangedError } from './stale-edit';

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error('Partner routing confirmation is unavailable.');
  return process.env.AUTH_SECRET;
}
const digest = (intent: unknown) => createHash('sha256').update(JSON.stringify(intent)).digest('hex');
export function signPartnerRoutingIntent(actorId: number, intent: unknown) {
  const body = `${actorId}.${Date.now() + 15 * 60_000}.${digest(intent)}`;
  return `${body}.${createHmac('sha256', secret()).update(body).digest('hex')}`;
}
export function verifyPartnerRoutingIntent(token: string, actorId: number, intent: unknown) {
  const parts = token.split('.'), [id, expiry, hash, signature] = parts;
  const expected = createHmac('sha256', secret()).update(`${id}.${expiry}.${hash}`).digest('hex');
  if (parts.length !== 4 || id !== String(actorId) || !/^\d+$/.test(expiry) || Number(expiry) < Date.now() || hash !== digest(intent) || !/^[a-f0-9]{64}$/.test(signature ?? '') || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new RecordChangedError();
}
