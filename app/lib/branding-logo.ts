import { fileTypeFromBuffer } from 'file-type';

export const MAX_BRANDING_LOGO_BYTES = 1024 * 1024;
const supported: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export async function validateBrandingLogo(file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>) {
  const extension = file.name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? '';
  const mimeType = supported[extension];
  if (!mimeType || file.type !== mimeType) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (!file.size || file.size > MAX_BRANDING_LOGO_BYTES) throw new Error('Logo must be 1 MB or smaller.');
  const body = new Uint8Array(await file.arrayBuffer());
  if (body.length !== file.size || (await fileTypeFromBuffer(body))?.mime !== mimeType) throw new Error('The image contents do not match its file type.');
  return { body, mimeType };
}
