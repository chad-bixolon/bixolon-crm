import { extname } from 'node:path';
import { safeOriginalFileName } from './document-file-rules';
import { MAX_SUPPORT_ATTACHMENT_BYTES } from './support-attachment-constants';

export const supportBinaryTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf',
};
export const supportTextTypes: Record<string, string> = {
  '.txt': 'text/plain', '.csv': 'text/csv', '.prn': 'text/plain',
  '.log': 'text/plain', '.xml': 'application/xml', '.json': 'application/json',
  '.zpl': 'text/plain', '.cfg': 'text/plain', '.config': 'text/plain',
};
export function validateSupportAttachmentEnvelope(name: string, browserMime: string, size: number) {
  const originalFileName = safeOriginalFileName(name);
  if (!size) throw new Error('The selected file is empty.');
  if (size > MAX_SUPPORT_ATTACHMENT_BYTES) throw new Error('File is too large. Maximum size is 25 MB.');
  const extension = extname(originalFileName).toLowerCase();
  const mimeType = supportBinaryTypes[extension] ?? supportTextTypes[extension];
  if (!mimeType) throw new Error('File type is not supported.');
  const acceptable = new Set(['', 'application/octet-stream', mimeType, 'text/plain']);
  if (extension === '.xml') acceptable.add('text/xml');
  if (extension === '.csv') acceptable.add('application/vnd.ms-excel');
  const provided = browserMime.toLowerCase();
  if (supportBinaryTypes[extension] && provided !== mimeType && provided !== 'application/octet-stream' && provided !== '') throw new Error('File type is not supported.');
  if (!supportBinaryTypes[extension] && !acceptable.has(provided)) throw new Error('File type is not supported.');
  return { originalFileName, extension, mimeType, binary: !!supportBinaryTypes[extension] };
}

export function validateSupportTextBytes(body: Uint8Array, detectedMime?: string) {
  if (detectedMime || body.includes(0)) throw new Error('File type is not supported.');
  try { new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw new Error('File type is not supported.'); }
}
