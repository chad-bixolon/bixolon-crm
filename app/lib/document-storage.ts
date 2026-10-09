import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertStorageKeyInPrefix, createDocumentStorageKey, createSupportAttachmentKey, readDocumentStorageConfig } from './document-storage-config';

export type DocumentObjectUpload = { storageKey: string; body: Uint8Array; mimeType: string };
export type DocumentSignedUrlInput = { storageKey: string; fileName: string; mimeType: string };
export interface DocumentStorage {
  createKey(): string;
  createSupportKey(): string;
  uploadDocumentObject(input: DocumentObjectUpload): Promise<void>;
  createSignedDocumentUrl(input: DocumentSignedUrlInput): Promise<string>;
  deleteObjectForFailedUpload(storageKey: string): Promise<void>;
}

const localRoot = '/tmp/saleshub-e2e-storage';
const localEnabled = () => process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_ENABLED === 'true' && process.env.E2E_STORAGE_ENABLED === 'true';
const localPath = (key: string) => join(localRoot, createHash('sha256').update(key).digest('hex'));
function localSignature(key: string, expires: number) { return createHmac('sha256', process.env.AUTH_SECRET || '').update(`${key}:${expires}`).digest('hex'); }
export async function readLocalSignedObject(key: string, expires: number, signature: string) {
  if (!localEnabled() || !Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) throw new Error('Unavailable');
  const expected = localSignature(key, expires);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Unavailable');
  if (!/^e2e\/((documents|support-cases))\/[0-9a-f-]{36}$/.test(key)) throw new Error('Unavailable');
  return readFile(localPath(key));
}

function client() {
  const config = readDocumentStorageConfig();
  return { config, s3: new S3Client({ region: config.region, endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) };
}

function contentDisposition(fileName: string, inline: boolean) {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'document';
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const documentStorage: DocumentStorage = {
  createKey() {
    return createDocumentStorageKey(localEnabled() ? 'e2e' : readDocumentStorageConfig().prefix);
  },
  createSupportKey() { return createSupportAttachmentKey(localEnabled() ? 'e2e' : readDocumentStorageConfig().prefix); },
  async uploadDocumentObject(input) {
    if (localEnabled()) { assertStorageKeyInPrefix(input.storageKey, 'e2e'); await mkdir(localRoot, { recursive: true }); await writeFile(localPath(input.storageKey), input.body); return; }
    const { config, s3 } = client();
    assertStorageKeyInPrefix(input.storageKey, config.prefix);
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: input.storageKey, Body: input.body, ContentType: input.mimeType }));
  },
  async createSignedDocumentUrl(input) {
    if (localEnabled()) {
      assertStorageKeyInPrefix(input.storageKey, 'e2e');
      const expires = Math.floor(Date.now() / 1000) + 300;
      const url = new URL('/api/e2e/objects', process.env.AUTH_URL);
      url.searchParams.set('key', input.storageKey); url.searchParams.set('expires', String(expires)); url.searchParams.set('signature', localSignature(input.storageKey, expires));
      url.searchParams.set('name', input.fileName); url.searchParams.set('type', input.mimeType);
      return url.toString();
    }
    const { config, s3 } = client();
    assertStorageKeyInPrefix(input.storageKey, config.prefix);
    return getSignedUrl(s3, new GetObjectCommand({
      Bucket: config.bucket, Key: input.storageKey,
      ResponseContentType: input.mimeType,
      ResponseContentDisposition: contentDisposition(input.fileName, input.mimeType === 'application/pdf'),
    }), { expiresIn: 300 });
  },
  async deleteObjectForFailedUpload(storageKey) {
    if (localEnabled()) { assertStorageKeyInPrefix(storageKey, 'e2e'); await unlink(localPath(storageKey)); return; }
    const { config, s3 } = client();
    assertStorageKeyInPrefix(storageKey, config.prefix);
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
  },
};
