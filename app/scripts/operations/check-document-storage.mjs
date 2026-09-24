#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const names = ['SPACES_BUCKET', 'SPACES_REGION', 'SPACES_ENDPOINT', 'SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY', 'SPACES_PREFIX'];
if (names.some(name => !process.env[name]?.trim())) throw new Error('Document storage is not configured.');
const prefix = process.env.SPACES_PREFIX.trim().replace(/^\/+|\/+$/g, '');
if (prefix !== 'dev') throw new Error('Connectivity checks are restricted to SPACES_PREFIX=dev.');
const endpoint = new URL(process.env.SPACES_ENDPOINT);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Document storage endpoint is invalid.');
const client = new S3Client({ region: process.env.SPACES_REGION, endpoint: endpoint.toString(), credentials: { accessKeyId: process.env.SPACES_ACCESS_KEY_ID, secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY } });
const Bucket = process.env.SPACES_BUCKET;
const Key = `${prefix}/documents/connectivity-check-${randomUUID()}`;
let uploaded = false;
try {
  await client.send(new PutObjectCommand({ Bucket, Key, Body: new TextEncoder().encode('BIXOLON SalesHub storage connectivity check'), ContentType: 'text/plain' }));
  uploaded = true;
  await client.send(new HeadObjectCommand({ Bucket, Key }));
  const result = await client.send(new GetObjectCommand({ Bucket, Key }));
  if (!result.Body || (await result.Body.transformToString()) !== 'BIXOLON SalesHub storage connectivity check') throw new Error('Connectivity object could not be verified.');
  console.log('PASS: development document storage upload and private read succeeded.');
} finally {
  if (uploaded) {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
    try { await client.send(new HeadObjectCommand({ Bucket, Key })); throw new Error('Connectivity object cleanup could not be verified.'); }
    catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') throw error;
    }
    console.log('PASS: development connectivity object was deleted and cleanup verified.');
  }
}
