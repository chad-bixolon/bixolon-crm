import { fileTypeFromBuffer } from 'file-type';
import { validateDocumentEnvelope, validateDocumentSignature } from './document-file-rules';
export { ACCEPTED_DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES } from './document-constants';

export type ValidatedDocumentFile = { originalFileName: string; mimeType: string; fileSize: number; body: Uint8Array };

export async function validateDocumentFile(file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>): Promise<ValidatedDocumentFile> {
  const { originalFileName, expected } = validateDocumentEnvelope(file.name, file.type, file.size);
  const body = new Uint8Array(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(body);
  validateDocumentSignature(expected, body, detected?.mime);
  return { originalFileName, mimeType: expected.mime, fileSize: body.byteLength, body };
}
