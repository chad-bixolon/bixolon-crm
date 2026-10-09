import { fileTypeFromBuffer } from 'file-type';
import { validateSupportAttachmentEnvelope, validateSupportTextBytes } from './support-attachment-rules';
import { MAX_SUPPORT_ATTACHMENT_BYTES, SUPPORT_ATTACHMENT_ACCEPT } from './support-attachment-constants';

export { MAX_SUPPORT_ATTACHMENT_BYTES, SUPPORT_ATTACHMENT_ACCEPT };
export type ValidatedSupportAttachment = { originalFileName: string; mimeType: string; fileSize: number; body: Uint8Array };

export async function validateSupportAttachment(file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>): Promise<ValidatedSupportAttachment> {
  const { originalFileName, mimeType, binary } = validateSupportAttachmentEnvelope(file.name, file.type, file.size);
  const body = new Uint8Array(await file.arrayBuffer());
  if (!body.length || body.length > MAX_SUPPORT_ATTACHMENT_BYTES || body.length !== file.size) throw new Error('File is too large or incomplete.');
  const detected = await fileTypeFromBuffer(body);
  if (binary) {
    if (detected?.mime !== mimeType) throw new Error('File type is not supported.');
  } else {
    validateSupportTextBytes(body, detected?.mime);
  }
  return { originalFileName, mimeType, fileSize: body.length, body };
}
