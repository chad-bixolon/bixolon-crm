import { randomUUID } from 'node:crypto';

export type DocumentStorageConfig = {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
};

const SAFE_PREFIX_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeStoragePrefix(value: string | undefined) {
  const prefix = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  if (!prefix || prefix.includes('\\') || prefix.split('/').some(part => !SAFE_PREFIX_PART.test(part) || part === '.' || part === '..')) {
    throw new Error('Document storage prefix is invalid.');
  }
  return prefix;
}

export function readDocumentStorageConfig(environment: NodeJS.ProcessEnv = process.env): DocumentStorageConfig {
  const required = ['SPACES_BUCKET', 'SPACES_REGION', 'SPACES_ENDPOINT', 'SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY'] as const;
  if (required.some(name => !environment[name]?.trim())) throw new Error('Document storage is not configured.');
  let endpoint: URL;
  try { endpoint = new URL(environment.SPACES_ENDPOINT!); } catch { throw new Error('Document storage endpoint is invalid.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Document storage endpoint is invalid.');
  }
  return {
    bucket: environment.SPACES_BUCKET!.trim(), region: environment.SPACES_REGION!.trim(), endpoint: endpoint.toString().replace(/\/$/, ''),
    accessKeyId: environment.SPACES_ACCESS_KEY_ID!.trim(), secretAccessKey: environment.SPACES_SECRET_ACCESS_KEY!,
    prefix: normalizeStoragePrefix(environment.SPACES_PREFIX),
  };
}

export function createDocumentStorageKey(prefix: string, id = randomUUID()) {
  const normalized = normalizeStoragePrefix(prefix);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Document object identifier is invalid.');
  }
  return `${normalized}/documents/${id.toLowerCase()}`;
}

export function assertStorageKeyInPrefix(storageKey: string, prefix: string) {
  const root = `${normalizeStoragePrefix(prefix)}/documents/`;
  if (!storageKey.startsWith(root) || storageKey.slice(root.length).includes('/')) throw new Error('Document storage key is outside the configured prefix.');
}
