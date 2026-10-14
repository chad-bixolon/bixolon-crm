import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { supportGmailOrigin, supportGmailDatabaseIdentity, SUPPORT_GMAIL_SCOPE } from './support-gmail-config';

export function supportGmailEncryptionKey() {
  const raw = process.env.SUPPORT_GMAIL_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new Error('SUPPORT_GMAIL_ENCRYPTION_KEY must be a base64 encoded 32-byte key.');
  return key;
}
function context(mailbox: string) {
  // Copying a database/token to another host, DB, client or mailbox fails closed.
  if (!process.env.SUPPORT_GMAIL_CLIENT_ID) throw new Error('Dedicated Support Gmail OAuth client is required.');
  return Buffer.from(JSON.stringify(['saleshub:support-gmail:refresh:v1', supportGmailOrigin(), supportGmailDatabaseIdentity(), process.env.SUPPORT_GMAIL_CLIENT_ID, mailbox, SUPPORT_GMAIL_SCOPE]));
}
export function encryptSupportGmailToken(token: string, mailbox: string) {
  if (!token) throw new Error('Missing Support Gmail refresh token.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', supportGmailEncryptionKey(), iv);
  cipher.setAAD(context(mailbox));
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`;
}
export function decryptSupportGmailToken(value: string, mailbox: string) {
  const [version, ivRaw, tagRaw, dataRaw, extra] = value.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw || extra) throw new Error('Invalid Support Gmail credential. Reconnect Gmail.');
  const iv = Buffer.from(ivRaw, 'base64url'), tag = Buffer.from(tagRaw, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid Support Gmail credential. Reconnect Gmail.');
  const decipher = createDecipheriv('aes-256-gcm', supportGmailEncryptionKey(), iv);
  decipher.setAAD(context(mailbox));
  decipher.setAuthTag(tag);
  const token = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
  if (!token) throw new Error('Invalid Support Gmail credential. Reconnect Gmail.');
  return token;
}
