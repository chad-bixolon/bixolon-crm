import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertStorageKeyInPrefix, createDocumentStorageKey, readDocumentStorageConfig } from './document-storage-config';

export type DocumentObjectUpload = { storageKey: string; body: Uint8Array; mimeType: string };
export type DocumentSignedUrlInput = { storageKey: string; fileName: string; mimeType: string };
export interface DocumentStorage {
  createKey(): string;
  uploadDocumentObject(input: DocumentObjectUpload): Promise<void>;
  createSignedDocumentUrl(input: DocumentSignedUrlInput): Promise<string>;
  deleteObjectForFailedUpload(storageKey: string): Promise<void>;
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
    return createDocumentStorageKey(readDocumentStorageConfig().prefix);
  },
  async uploadDocumentObject(input) {
    const { config, s3 } = client();
    assertStorageKeyInPrefix(input.storageKey, config.prefix);
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: input.storageKey, Body: input.body, ContentType: input.mimeType }));
  },
  async createSignedDocumentUrl(input) {
    const { config, s3 } = client();
    assertStorageKeyInPrefix(input.storageKey, config.prefix);
    return getSignedUrl(s3, new GetObjectCommand({
      Bucket: config.bucket, Key: input.storageKey,
      ResponseContentType: input.mimeType,
      ResponseContentDisposition: contentDisposition(input.fileName, input.mimeType === 'application/pdf'),
    }), { expiresIn: 300 });
  },
  async deleteObjectForFailedUpload(storageKey) {
    const { config, s3 } = client();
    assertStorageKeyInPrefix(storageKey, config.prefix);
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
  },
};
