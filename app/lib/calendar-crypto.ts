import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters.');
  return Buffer.from(raw, 'hex');
}

export function encryptCalendarToken(token: string) {
  if (!token) throw new Error('Missing Calendar credential.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from('saleshub:google-calendar:refresh:v1'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptCalendarToken(value: string) {
  const [version, ivRaw, tagRaw, ciphertextRaw, extra] = value.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw || extra) throw new Error('Invalid Calendar credential format.');
  const iv = Buffer.from(ivRaw, 'base64url'), tag = Buffer.from(tagRaw, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid Calendar credential format.');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAAD(Buffer.from('saleshub:google-calendar:refresh:v1'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
}
