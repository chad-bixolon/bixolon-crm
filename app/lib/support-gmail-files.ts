import { validateSupportAttachmentEnvelope } from './support-attachment-rules';
import { MAX_SUPPORT_ATTACHMENT_BYTES } from './support-attachment-constants';
export type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
export type SupportMailFile = { partId: string; attachmentId: string | null; fileName: string; mimeType: string; size: number; kind: 'attachment' | 'inline'; hiddenReason: string | null; unavailableReason: string | null };
const header = (part: GmailPart, name: string) => part.headers?.find(row => row.name.toLowerCase() === name)?.value ?? '';
export function isFilePart(part: GmailPart) { return !!part.filename || /^attachment\b/i.test(header(part, 'content-disposition')) || (!!part.body?.attachmentId && !['text/plain', 'text/html'].includes(part.mimeType ?? '')) || /^image\//i.test(part.mimeType ?? ''); }
export function gmailParts(root: GmailPart | undefined, path = 'root'): { part: GmailPart; partId: string }[] {
  if (!root) return [];
  return [{ part: root, partId: root.partId || path }, ...(root.parts ?? []).flatMap((part, index) => gmailParts(part, `${path}.${index}`))];
}
export function discoverGmailFiles(root: GmailPart | undefined): SupportMailFile[] {
  const parts = gmailParts(root);
  const html = parts.filter(({ part }) => part.mimeType === 'text/html' && !isFilePart(part)).map(({ part }) => Buffer.from(part.body?.data ?? '', 'base64url').toString('utf8')).join('\n');
  return parts.filter(({ part }) => isFilePart(part) && !(part.parts?.length)).map(({ part, partId }) => {
    const mimeType = (part.mimeType ?? 'application/octet-stream').toLowerCase();
    const cid = header(part, 'content-id').replace(/^<|>$/g, '');
    const inline = !/^attachment\b/i.test(header(part, 'content-disposition')) && (!!cid || /^inline\b/i.test(header(part, 'content-disposition')) || mimeType.startsWith('image/'));
    const fileName = part.filename || `email-image-${partId.replace(/[^a-zA-Z0-9_-]/g, '-')}.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'application/xml': 'xml' } as Record<string, string>)[mimeType] ?? 'bin'}`;
    const size = part.body?.size ?? (part.body?.data ? Buffer.byteLength(part.body.data, 'base64url') : 0);
    let hiddenReason: string | null = null;
    if (inline) {
      const tag = cid ? (html.match(/<img\b[^>]*>/gi) ?? []).find(tag => tag.includes(`cid:${cid}`)) ?? '' : '';
      const dimension = (name: string) => Number(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i'))?.[1] ?? tag.match(new RegExp(`${name}\\s*:\\s*(\\d+)px`, 'i'))?.[1] ?? 0);
      const width = dimension('width'), height = dimension('height');
      if (!mimeType.startsWith('image/')) hiddenReason = 'Unrecognized inline asset';
      else if (size < 8192 || (width > 0 && height > 0 && (width <= 96 || height <= 96))) hiddenReason = 'Small image or possible tracking/decorative asset';
      else if (/(?:logo|signature|social|facebook|linkedin|twitter|instagram|youtube|banner|footer|spacer|tracking|pixel|icon)/i.test(fileName)) hiddenReason = 'Likely signature or decorative image';
      else if (!/(?:photo|screenshot|printer|error|diagnostic|damage)/i.test(fileName) && !(width >= 300 && height >= 300)) hiddenReason = 'Inline image purpose is uncertain';
    }
    let unavailableReason: string | null = null;
    try { validateSupportAttachmentEnvelope(fileName, mimeType, size); }
    catch (error) { unavailableReason = error instanceof Error ? error.message : 'File is unavailable.'; }
    if (!Number.isSafeInteger(size) || size < 0) unavailableReason = 'File size is invalid.';
    if (!part.body?.attachmentId && !part.body?.data) unavailableReason = 'No downloadable file content.';
    return { partId, attachmentId: part.body?.attachmentId ?? null, fileName, mimeType, size, kind: inline ? 'inline' : 'attachment', hiddenReason, unavailableReason };
  });
}
export function decodeGmailFile(data: string | undefined, expectedSize: number) {
  if (!data || !/^[A-Za-z0-9_-]+={0,2}$/.test(data) || data.length > Math.ceil(MAX_SUPPORT_ATTACHMENT_BYTES / 3) * 4 + 4) throw new Error('File is too large or incomplete.');
  const body = Buffer.from(data, 'base64url');
  if (!body.length || body.length !== expectedSize || body.length > MAX_SUPPORT_ATTACHMENT_BYTES) throw new Error('File is too large or incomplete.');
  return new Uint8Array(body);
}
