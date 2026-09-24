import { extname } from 'node:path';
import { MAX_DOCUMENT_BYTES } from './document-constants';

export type DocumentFileFamily = 'pdf' | 'ooxml' | 'ole';
export type AllowedDocumentFile = { mime: string; family: DocumentFileFamily };
export const allowedDocumentFiles: Record<string, AllowedDocumentFile> = {
  '.pdf': { mime: 'application/pdf', family: 'pdf' },
  '.doc': { mime: 'application/msword', family: 'ole' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', family: 'ooxml' },
  '.xls': { mime: 'application/vnd.ms-excel', family: 'ole' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'ooxml' },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', family: 'ole' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', family: 'ooxml' },
};
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function safeOriginalFileName(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? '';
  if (!name || name.length > 255 || name === '.' || name === '..') throw new Error('Choose a file with a valid name.');
  return name;
}

export function validateDocumentEnvelope(name: string, browserMime: string, size: number) {
  const originalFileName = safeOriginalFileName(name);
  if (size < 1) throw new Error('The selected file is empty.');
  if (size > MAX_DOCUMENT_BYTES) throw new Error('Documents must be 25 MB or smaller.');
  const extension = extname(originalFileName).toLowerCase();
  const expected = allowedDocumentFiles[extension];
  if (!expected) throw new Error('Unsupported file type. Upload a PDF or Microsoft Office document.');
  if (browserMime && browserMime !== expected.mime && browserMime !== 'application/octet-stream') throw new Error('The file extension and content type do not match.');
  return { originalFileName, extension, expected };
}

export function validateDocumentSignature(expected: AllowedDocumentFile, bytes: Uint8Array, detectedMime?: string) {
  const signatureMatches = expected.family === 'ole'
    ? OLE_SIGNATURE.every((byte, index) => bytes[index] === byte)
    : detectedMime === expected.mime;
  if (!signatureMatches) throw new Error('The file contents do not match the selected file type.');
}
