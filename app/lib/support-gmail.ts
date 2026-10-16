import { supportGmailRuntime, gmailWorkflow, type SupportGmailRuntime } from './support-gmail-runtime';
import { discoverGmailFiles, gmailParts, isFilePart, decodeGmailFile, type GmailPart, type SupportMailFile } from './support-gmail-files';
import { connectedRefreshToken, verifyReadOnlyScope, recordSupportGmailFetch, supportGmailReadIdentity } from './support-gmail-connection';
import { assertLiveSupportGmailEnvironment, assertSupportGmailEnabled, supportGmailMockMode, supportGmailTestFixtureMode, supportGmailLookbackDays } from './support-gmail-config';
import { logSupportGmailReadFailure, throwSupportGmailHttpError, type SupportGmailReadStage } from './support-gmail-errors';
export * from './support-gmail-config';
export type SupportMailMessage = { id: string; threadId: string; senderEmail: string; senderName: string | null; recipients: string; subject: string; snippet: string; bodyText: string; messageDate: Date; sourceExcluded?: boolean; hasAttachments?: boolean; files?: SupportMailFile[] };
export type SupportMailReview = { message: SupportMailMessage | null; error?: string };
export interface GmailSupportMailbox { recent(): Promise<SupportMailMessage[]>; get(id: string): Promise<SupportMailMessage | null>; getMany?(ids: string[]): Promise<(SupportMailMessage | null)[]>; review?(ids: string[]): Promise<SupportMailReview[]>; attachment(messageId: string, partId: string): Promise<{ message: SupportMailMessage; file: SupportMailFile; body: Uint8Array }> }

let lastFetch: { at: Date | null; result: string } = { at: null, result: 'No fetch yet' };
export function supportGmailFetchStatus() { return lastFetch; }
export async function recentSupportMail(): Promise<SupportMailMessage[]> {
  try {
    const messages = await gmailWorkflow('inbox', () => supportMailbox().recent());
    const at = new Date();
    if (!supportGmailMockMode() && !supportGmailTestFixtureMode()) await recordSupportGmailFetch(at);
    lastFetch = { at, result: `Fetched ${messages.length} messages` };
    return messages;
  } catch (error) {
    lastFetch = { ...lastFetch, result: error instanceof Error ? error.message : 'Could not read Support mailbox.' };
    throw error;
  }
}

const fixtureBase = new Date();
const daysAgo = (days: number) => new Date(fixtureBase.getTime() - days * 86400000);
const mockMessages: SupportMailMessage[] = [
  { id: 'poc-xd5-1', threadId: 'poc-xd5-thread', senderEmail: 'e2e-picker-00@example.test', senderName: 'E2E Picker Contact', recipients: 'support@bixolonusa.com', subject: 'XD5 printer still jamming', snippet: 'The XD5 printer is still jamming after a restart.', bodyText: 'The XD5 printer is still jamming after a restart. Please advise.', messageDate: daysAgo(1) },
  { id: 'poc-unrelated-1', threadId: 'poc-unrelated-thread', senderEmail: 'stranger@example.test', senderName: null, recipients: 'support@bixolonusa.com', subject: 'Unrelated mailbox message', snippet: 'This should stay in the inbox only.', bodyText: 'This should stay in the inbox only.', messageDate: daysAgo(2) },
];
// A test-run value keeps identities stable across route modules and retained-data UAT runs.
const intakeFixtureRun = process.env.SUPPORT_EMAIL_INTAKE_FIXTURE_RUN || 'fixture';
for (const [kind, senderEmail, senderName] of [
  ['matched', 'e2e-picker-00@example.test', 'E2E Picker Contact'],
  ['unmatched', 'intake-new@example.test', 'New Requester'],
  ['invalid', 'intake-invalid@example.test', 'Invalid Source Test'],
  ['manual', 'e2e-picker-00@example.test', 'E2E Picker Contact'],
] as const) mockMessages.push({ id: `poc-intake-${kind}-${intakeFixtureRun}`, threadId: `poc-intake-${kind}-thread-${intakeFixtureRun}`, senderEmail, senderName, recipients: 'support@bixolonusa.com', subject: `POC intake ${kind} request`, snippet: 'Please help with the printer.', bodyText: 'Please help with the printer.', messageDate: daysAgo(0.1) });
const scenarios: [string, string, string, string, number, string?][] = [
  ['known-contact','e2e-picker-00@example.test','XD5 cutter failure','The cutter is sticking after cleaning.',1],
  ['follow-up','e2e-picker-00@example.test','Re: XD5 cutter failure','Following up on the cutter.\n> Previous reply: please clean the printer.',0.5,'poc-cutter-thread'],
  ['reseller','reseller@example.test','End user needs SRP repair','Customer / End User: North Test Shop. We are the reseller.',3],
  ['unknown','new-customer@example.test','Printer will not power on','We have no account yet. Please advise.',4],
  ['internal','agent@bixolonusa.com','Internal handoff','Please review this customer issue.',5],
  ['vendor','invoices@vendor.example','Invoice reminder','An unrelated vendor invoice.',6],
  ['newsletter','offers@promo.example','Autumn offers','Unsubscribe from our newsletter.',7],
  ['system','alerts@monitor.example','Automated printer alert','Device offline event.',8],
  ['out-of-office','reply@example.test','Automatic reply: out of office','I am away until Monday.',9],
  ['bounce','mailer-daemon@example.test','Delivery Status Notification (Failure)','Message could not be delivered.',10],
  ['bxs-subject','new-customer@example.test','Re: BXS-2026-900001 printer issue','Please check this case.',11],
  ['bxs-body','new-customer@example.test','Case question','Regarding BXS-2026-000123',12],
  ['bxs-two','new-customer@example.test','Two cases','BXS-2026-000123 and BXS-2026-000124 need review.',13],
  ['bxs-malformed','new-customer@example.test','BXS-26-123','This number is malformed.',14],
  ['bxs-missing','new-customer@example.test','BXS-2026-999999','This case does not exist.',15],
  ['bxs-quoted','new-customer@example.test','New printer issue','New problem.\n> Old thread BXS-2026-000123',16],
  ['no-subject','new-customer@example.test','(no subject)','Please call me.',17],
  ['unicode','josé@example.test','Étiquette imprimante – 東京','Résumé: l’imprimante ne répond pas. 😊',18],
  ['malicious','<script>alert(1)</script>@example.test','<img src=x onerror=alert(1)>','<script>alert(1)</script>\n<img src=x onerror=alert(1)>',19],
  ['empty','new-customer@example.test','Empty body','',20],
  ['duplicates-a','duplicate@example.test','Same text','Identical body.',21],
  ['duplicates-b','duplicate@example.test','Same text','Identical body.',21],
  ['ambiguous-contact','shared@example.test','Shared address','Which Contact is this?',22],
  ['long-subject','new-customer@example.test','Printer issue '.repeat(45),'Short description.',23],
  ['long-body','new-customer@example.test','Long diagnostic report','😀 diagnostic line\n'.repeat(1800),24],
  ['signature','new-customer@example.test','Receipt printer issue','Printer fails.\n--\nSupport desk\nConfidentiality notice: intended recipient only.',25],
  ['whitespace','new-customer@example.test','Odd spacing',' First line\t\tsecond line\n\n\n third line ',26],
  ['multiple-recipients','new-customer@example.test','CC sales','Please include our reseller.',27],
  ['html-only','new-customer@example.test','HTML only sample','Plain text extracted from HTML.',28],
  ['archived-contact','archived@example.test','Old contact','Should not suggest archived contact.',29],
  ['contact-no-account','solo@example.test','Individual repair','No Account relationship.',30],
  ['account-no-contact','unknown@known-account.example','Known account?','Do not infer account from domain.',31],
  ['thread-conflict','new-customer@example.test','Conflicting thread','Needs human review.',32,'poc-conflict-thread'],
  ['cutoff-inside','new-customer@example.test','At cutoff','Inside by one second.',29.99998],
  ['cutoff-outside','new-customer@example.test','Outside cutoff','Older than 30 days.',30.00002],
  ['historical','new-customer@example.test','Historical mail','Should not display.',120],
];
for (const [id, senderEmail, subject, bodyText, age, thread] of scenarios) mockMessages.push({ id: `poc-${id}`, threadId: thread ?? `poc-${id}-thread`, senderEmail, senderName: null, recipients: id === 'multiple-recipients' ? 'support@bixolonusa.com, agent@bixolonusa.com' : 'support@bixolonusa.com', subject, snippet: bodyText.slice(0, 140), bodyText, messageDate: daysAgo(age), hasAttachments: id === 'multiple-recipients' });
for (let i = 1; i <= 5; i++) mockMessages.push({ id: `poc-thread-${i}`, threadId: 'poc-five-message-thread', senderEmail: 'new-customer@example.test', senderName: 'Test Customer', recipients: 'support@bixolonusa.com', subject: `Re: printer service ${i}`, snippet: `Reply ${i}`, bodyText: `Reply ${i}\n> Earlier conversation`, messageDate: daysAgo(i + 1) });
for (let i = 0; i < 150; i++) mockMessages.push({ id: `poc-volume-${i}`, threadId: `poc-volume-thread-${i}`, senderEmail: `customer-${i}@example.test`, senderName: null, recipients: 'support@bixolonusa.com', subject: `Routine service question ${i}`, snippet: 'Synthetic volume fixture.', bodyText: 'Synthetic volume fixture.', messageDate: daysAgo(29.9 + i / 1500) });
const fixtureFileBodies = new Map<string, Uint8Array>();
fixtureFileBodies.set('log', new TextEncoder().encode('Printer diagnostic log: paper jam.\n'));
fixtureFileBodies.set('flaky', new TextEncoder().encode('Recovered diagnostic data.\n'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
fixtureFileBodies.set('logo', new Uint8Array(Buffer.concat([png, Buffer.alloc(200 - png.length)])));
fixtureFileBodies.set('pixel', new Uint8Array(Buffer.concat([png, Buffer.alloc(80 - png.length)])));
fixtureFileBodies.set('photo', new Uint8Array(Buffer.concat([png, Buffer.alloc(9000)])));
const fixtureState = globalThis as typeof globalThis & { supportEmailFixtureRetries?: Set<string> };
const retriedFixtureFiles = fixtureState.supportEmailFixtureRetries ??= new Set<string>();
for (const kind of ['files', 'files-failure', 'files-unselected']) {
  const files: SupportMailFile[] = [
    { partId: 'log', attachmentId: 'fixture-log', fileName: 'error-log.txt', mimeType: 'text/plain', size: fixtureFileBodies.get('log')!.length, kind: 'attachment', hiddenReason: null, unavailableReason: null },
    { partId: 'photo', attachmentId: null, fileName: 'printer-photo.png', mimeType: 'image/png', size: fixtureFileBodies.get('photo')!.length, kind: 'inline', hiddenReason: null, unavailableReason: null },
    { partId: 'logo', attachmentId: 'fixture-logo', fileName: 'signature-logo.png', mimeType: 'image/png', size: 200, kind: 'inline', hiddenReason: 'Likely signature or decorative image', unavailableReason: null },
    { partId: 'pixel', attachmentId: 'fixture-pixel', fileName: 'tracking-pixel.png', mimeType: 'image/png', size: 80, kind: 'inline', hiddenReason: 'Small image or possible tracking asset', unavailableReason: null },
    { partId: 'exe', attachmentId: 'fixture-exe', fileName: 'program.exe', mimeType: 'application/octet-stream', size: 100, kind: 'attachment', hiddenReason: null, unavailableReason: 'File type is not supported.' },
    { partId: 'big', attachmentId: 'fixture-big', fileName: 'huge.log', mimeType: 'text/plain', size: 26 * 1024 * 1024, kind: 'attachment', hiddenReason: null, unavailableReason: 'File is too large. Maximum size is 25 MB.' },
  ];
  if (kind === 'files-failure') files.push({ partId: 'flaky', attachmentId: 'fixture-flaky', fileName: 'retry-log.txt', mimeType: 'text/plain', size: fixtureFileBodies.get('flaky')!.length, kind: 'attachment', hiddenReason: null, unavailableReason: null });
  mockMessages.push({ id: `poc-intake-${kind}-${intakeFixtureRun}`, threadId: `poc-intake-${kind}-thread-${intakeFixtureRun}`, senderEmail: 'files@example.test', senderName: 'File Requester', recipients: 'support@bixolonusa.com', subject: `POC intake ${kind} request`, snippet: 'Printer problem with optional files.', bodyText: 'Printer problem with optional files.', messageDate: daysAgo(0.2), hasAttachments: true, files });
}
const manualFileFixture = mockMessages.find(message => message.subject === 'POC intake manual request');
if (manualFileFixture) { manualFileFixture.files = mockMessages.find(message => message.subject === 'POC intake files request')!.files!.slice(0, 2); manualFileFixture.hasAttachments = true; }
export function withinLookback(date: Date, now = new Date(), days = 30) { return date.getTime() >= now.getTime() - days * 86400000; }
export function recentMockMessages(now = new Date(), count = 50, days = 30) { return mockMessages.filter(message => withinLookback(message.messageDate, now, days)).sort((a, b) => b.messageDate.getTime() - a.messageDate.getTime()).slice(0, Math.min(count, 50)); }
export class MockGmailSupportMailbox implements GmailSupportMailbox {
  async recent() { return recentMockMessages(new Date(), 50, supportGmailLookbackDays()); }
  async get(id: string) { return mockMessages.find(message => message.id === id) ?? null; }
  async attachment(messageId: string, partId: string) {
    const message = await this.get(messageId);
    const file = message?.files?.find(row => row.partId === partId);
    if (!message || !file || file.unavailableReason) throw new Error('Email file is unavailable.');
    if (partId === 'flaky' && !retriedFixtureFiles.has(messageId)) { retriedFixtureFiles.add(messageId); throw new Error('Support Gmail read failed.'); }
    const body = fixtureFileBodies.get(partId);
    if (!body) throw new Error('Email file is unavailable.');
    return { message, file, body };
  }
}

type GmailMessage = { labelIds?: string[]; id?: string; threadId?: string; snippet?: string; internalDate?: string; payload?: GmailPart & { headers?: { name: string; value: string }[] } };
export function htmlToPlainText(html: string) {
  return html.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity.toLowerCase()] ?? entity)
    .replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
function decodedText(part: GmailPart | undefined): string {
  if (!part || isFilePart(part)) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  const children = part.parts ?? [];
  for (const child of children.filter(item => item.mimeType !== 'text/html')) { const value = decodedText(child); if (value) return value; }
  for (const child of children.filter(item => item.mimeType === 'text/html')) { const value = decodedText(child); if (value) return value; }
  if (part.mimeType === 'text/html' && part.body?.data) return htmlToPlainText(Buffer.from(part.body.data, 'base64url').toString('utf8'));
  return '';
}
function containsAttachment(part: GmailPart | undefined): boolean { return !!part && (!!part.body?.attachmentId || !!part.filename || (part.parts ?? []).some(containsAttachment)); }
async function gmailFetch(url: string, options: RequestInit, fetcher: typeof fetch, stage: SupportGmailReadStage) {
  try { return await fetcher(url, { ...options, signal: AbortSignal.timeout(10000) }); }
  catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    logSupportGmailReadFailure(stage, 'none', timeout ? 'timeout' : 'network');
    throw new Error(timeout ? 'Support Gmail request timed out. Try again.' : 'Support Gmail connection failed. Try again.');
  }
}
async function gmailJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { throw new Error('Support Gmail returned an invalid response. Try again.'); }
}
function normalize(message: GmailMessage): SupportMailMessage {
  if (!message.id || !message.threadId) throw new Error('Gmail returned an incomplete message.');
  const header = (name: string) => message.payload?.headers?.find(item => item.name.toLowerCase() === name)?.value ?? '';
  const from = header('from');
  const address = from.match(/<([^<>]+)>/)?.[1] ?? from;
  const senderEmail = address.trim().toLowerCase();
  const senderName = from.includes('<') ? from.slice(0, from.lastIndexOf('<')).replace(/^"|"$/g, '').trim() || null : null;
  const date = Number(message.internalDate);
  if (!senderEmail || !senderEmail.includes('@') || !Number.isFinite(date) || date <= 0) throw new Error('Gmail returned an incomplete message.');
  return { sourceExcluded: message.labelIds?.some(label => label === 'SPAM' || label === 'TRASH'), id: message.id, threadId: message.threadId, senderEmail, senderName, recipients: header('to'), subject: header('subject') || '(no subject)', snippet: message.snippet ?? '', bodyText: decodedText(message.payload), messageDate: new Date(date), hasAttachments: containsAttachment(message.payload), files: discoverGmailFiles(message.payload) };
}

export class GoogleGmailSupportMailbox implements GmailSupportMailbox {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly runtime: SupportGmailRuntime = supportGmailRuntime) {}
  private async request(mailbox: string, url: string, options: RequestInit, stage: SupportGmailReadStage = 'read') {
    return this.runtime.request(mailbox, (options.method ?? 'GET') === 'GET', () => gmailFetch(url, options, this.fetcher, stage), response => throwSupportGmailHttpError(response, stage));
  }
  private async token(identity: { mailbox: string; version: string }) {
    assertLiveSupportGmailEnvironment();
    const { SUPPORT_GMAIL_CLIENT_ID: clientId, SUPPORT_GMAIL_CLIENT_SECRET: clientSecret } = process.env;
    const { refreshToken, email: mailbox, scope, connectedAt } = await connectedRefreshToken();
    if (identity.mailbox !== mailbox || identity.version !== connectedAt) throw new Error('Support Gmail connection changed. Please try again.');
    if (!clientId || !clientSecret) throw new Error('Dedicated Support Gmail OAuth client is required.');
    const response = await this.request(mailbox, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }), cache: 'no-store' }, 'token-refresh');
    if (!response.ok) await throwSupportGmailHttpError(response, 'token-refresh');
    const token = await gmailJson<{ access_token?: string; scope?: string }>(response);
    if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Support Gmail token refresh returned no access token.');
    verifyReadOnlyScope(token.scope ?? scope);
    const profile = await this.request(mailbox, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' }, 'profile');
    if (!profile.ok) await throwSupportGmailHttpError(profile, 'profile');
    if ((await gmailJson<{ emailAddress?: string }>(profile)).emailAddress?.toLowerCase() !== mailbox.toLowerCase()) throw new Error('Connected Gmail account does not match SUPPORT_GMAIL_MAILBOX.');
    return token.access_token;
  }
  private async read<T>(operation: string, expensive: boolean, ttl: number, run: (token: string, mailbox: string) => Promise<T>) {
    assertLiveSupportGmailEnvironment();
    const identity = await supportGmailReadIdentity();
    return this.runtime.run(identity.mailbox, identity.version, operation, expensive, ttl, async () => {
      const result = await run(await this.token(identity), identity.mailbox);
      // Never return/cache a result from a connection disconnected or replaced mid-read.
      const current = await supportGmailReadIdentity();
      if (current.mailbox !== identity.mailbox || current.version !== identity.version) throw new Error('Support Gmail connection changed. Please try again.');
      return result;
    });
  }
  private async gmail(path: string, token: string, mailbox: string) {
    const response = await this.request(mailbox, `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) await throwSupportGmailHttpError(response, 'read');
    return gmailJson<unknown>(response);
  }
  async recent() {
    const days = supportGmailLookbackDays();
    return this.read(`recent:${days}`, true, 10000, async (token, mailbox) => {
      const after = Math.floor((Date.now() - days * 86400000) / 1000) - 1;
      const result = await this.gmail(`messages?maxResults=50&q=${encodeURIComponent(`after:${after} -in:spam -in:trash`)}`, token, mailbox) as { messages?: { id: string }[] };
      const rows: GmailMessage[] = [];
      const ids = (result.messages ?? []).slice(0, 50);
      for (let index = 0; index < ids.length; index += 5) {
        // Drain all five reads before releasing the operation on failure.
        const batch = await Promise.allSettled(ids.slice(index, index + 5).map(row => this.gmail(`messages/${encodeURIComponent(row.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, token, mailbox) as Promise<GmailMessage>));
        for (const row of batch) { if (row.status === 'rejected') throw row.reason; rows.push(row.value); }
      }
      const cutoff = Date.now() - days * 86400000;
      return rows.map(row => ({ ...normalize(row), bodyText: '', files: undefined, hasAttachments: undefined })).filter(row => row.messageDate.getTime() >= cutoff).sort((a, b) => b.messageDate.getTime() - a.messageDate.getTime());
    });
  }
  private async message(id: string, token: string, mailbox: string) {
    const response = await this.request(mailbox, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) await throwSupportGmailHttpError(response, 'read');
    const message = normalize(await gmailJson<GmailMessage>(response));
    if (message.id !== id) throw new Error('Gmail returned an incomplete message.');
    return message;
  }
  async get(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
    return this.read(`get:${id}`, false, 0, (token, mailbox) => this.message(id, token, mailbox));
  }
  async getMany(ids: string[]) {
    if (ids.length > 50 || ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid Support inbox message.');
    return this.read(`getMany:${JSON.stringify(ids)}`, true, 0, async (token, mailbox) => {
      const messages = [];
      for (const id of ids) messages.push(await this.message(id, token, mailbox));
      return messages;
    });
  }
  async review(ids: string[]) {
    if (ids.length > 200 || ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid Gmail file source.');
    return this.read(`review:${JSON.stringify(ids)}`, true, 0, async (token, mailbox) => {
      const messages: SupportMailReview[] = [];
      for (const id of ids) {
        try { messages.push({ message: await this.message(id, token, mailbox) }); }
        catch (error) { messages.push({ message: null, error: error instanceof Error && /^Support Gmail /.test(error.message) ? error.message : 'Source email could not be read. Please retry.' }); }
      }
      return messages;
    });
  }
  async attachment(messageId: string, partId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(partId)) throw new Error('Invalid Gmail file source.');
    return this.read(`attachment:${messageId}:${partId}`, false, 0, async (token, mailbox) => {
      const raw = await this.gmail(`messages/${encodeURIComponent(messageId)}?format=full`, token, mailbox) as GmailMessage;
      const message = normalize(raw);
      if (message.id !== messageId) throw new Error('Invalid Gmail file source.');
      const file = message.files?.find(row => row.partId === partId);
      if (!file || file.unavailableReason) throw new Error(file?.unavailableReason || 'Email file is no longer available.');
      const part = gmailParts(raw.payload).find(row => row.partId === partId)!.part;
      let data = part.body?.data;
      if (file.attachmentId) {
        const result = await this.gmail(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(file.attachmentId)}`, token, mailbox) as { data?: string; size?: number };
        if (result.size !== file.size) throw new Error('File is too large or incomplete.');
        data = result.data;
      }
      return { message, file, body: decodeGmailFile(data, file.size) };
    });
  }
}
export async function fullSupportMessages(mailbox: GmailSupportMailbox, ids: string[]) {
  return mailbox.getMany ? mailbox.getMany(ids) : Promise.all(ids.map(id => mailbox.get(id)));
}
export function supportMailbox(): GmailSupportMailbox {
  assertSupportGmailEnabled();
  if (process.env.SUPPORT_GMAIL_MOCK === 'true' && !supportGmailMockMode() || process.env.SUPPORT_GMAIL_TEST_FIXTURE === 'true' && !supportGmailTestFixtureMode() && !supportGmailMockMode()) throw new Error('Support Gmail fixtures require local test authentication.');
  if (supportGmailMockMode() || supportGmailTestFixtureMode()) return new MockGmailSupportMailbox();
  assertLiveSupportGmailEnvironment();
  return new GoogleGmailSupportMailbox();
}
