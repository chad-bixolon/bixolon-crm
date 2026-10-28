import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { RecoveryError, assertPrivateRuntime, requireValue, positiveInteger } from './recovery-common.mjs';

export function spacesConfig(env) {
  assertPrivateRuntime(env);
  const region = requireValue(env, 'BACKUP_SPACES_REGION');
  const endpoint = requireValue(env, 'BACKUP_SPACES_ENDPOINT');
  if (!/^[a-z]{3}[1-9]$/.test(region) || endpoint !== `https://${region}.digitaloceanspaces.com`) throw new RecoveryError('configuration');
  const bucket = requireValue(env, 'BACKUP_SPACES_BUCKET');
  const documentsBucket = requireValue(env, 'BACKUP_DOCUMENTS_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket === documentsBucket || bucket === env.SPACES_BUCKET) throw new RecoveryError('configuration');
  return { region, endpoint, bucket,
    accessKeyId: requireValue(env, 'BACKUP_SPACES_ACCESS_KEY_ID'),
    secretAccessKey: requireValue(env, 'BACKUP_SPACES_SECRET_ACCESS_KEY'),
    maxBytes: positiveInteger(env.BACKUP_MAX_DUMP_BYTES, 1_073_741_824, 2_147_483_648),
  };
}

export function spacesStore(config, signal, clientOverride) {
  assertPrivateRuntime();
  const client = clientOverride || new S3Client({ region: config.region, endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 15_000, requestTimeout: 180_000 },
    followRegionRedirects: false,
  });
  const send = async (command, abortSignal = signal) => {
    try { return await client.send(command, { abortSignal }); }
    // SDK errors can include provider payloads/credentials. Callers map this
    // fixed internal failure to their upload, verification or download stage.
    catch { throw new RecoveryError('command'); }
  };
  return {
    async put(key, file, size, metadata) {
      // Single PUT deliberately bounded to <=2 GiB. No multipart debris or delete rights required by code.
      const body = createReadStream(file);
      const controller = new AbortController();
      const uploadSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let readFailed = false;
      // The stream can fail before the SDK attaches its own listeners. Handle
      // that error immediately and abort any pending HTTP upload before cleanup.
      const fileFailure = new Promise((_, reject) => {
        body.once('error', () => {
          readFailed = true;
          controller.abort();
          reject(new RecoveryError('temp'));
        });
      });
      try { await Promise.race([send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentLength: size,
        ACL: 'private', ContentType: 'application/octet-stream', Metadata: metadata,
      }), uploadSignal), fileFailure]); }
      catch (error) {
        if (signal?.aborted) throw new RecoveryError('interrupted');
        if (readFailed) throw new RecoveryError('temp');
        throw error;
      } finally { body.destroy(); controller.abort(); }
    },
    async head(key) {
      const result = await send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return { size: result.ContentLength, metadata: result.Metadata };
    },
    async get(key) {
      const result = await send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!result.Body) throw new RecoveryError('download');
      return result.Body;
    },
    close() { client.destroy(); },
  };
}

export async function verifyRemote(store, key, size, expected) {
  const head = await store.head(key);
  if (head.size !== size || head.metadata?.sha256 !== expected) throw new RecoveryError('spaces-verification');
  const body = await store.get(key);
  const hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.length;
      if (bytes > size) throw new RecoveryError('spaces-verification');
      hash.update(chunk);
    }
  } finally { body.destroy?.(); }
  if (bytes !== size || hash.digest('hex') !== expected) throw new RecoveryError('spaces-verification');
}
