import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;
const REDACTED = '[REDACTED]';
const allowedKeys = new Set(['requestId', 'correlationId', 'userId', 'route', 'operation', 'module', 'entityType', 'entityId', 'jobName', 'durationMs', 'integration', 'category', 'status', 'statusClass', 'processed', 'succeeded', 'skipped', 'failed', 'created', 'resolved', 'runId', 'stage', 'outcome', 'reason']);

export function newCorrelationId() { return randomUUID(); }
export function correlationIdFromHeader(value: string | null | undefined) {
  return value && (/^[0-9a-f]{32}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ? value.toLowerCase() : newCorrelationId();
}

const errorClasses = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError', 'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientValidationError', 'PrismaClientInitializationError', 'PrismaClientRustPanicError', 'SupportGmailHttpError', 'CalendarRequestFailure', 'RecordChangedError', 'SupportAttachmentMetadataError']);
function safeErrorClass(value: unknown) { return typeof value === 'string' && errorClasses.has(value) ? value : undefined; }

// Values are code-owned labels, never caller-provided prose. Add labels deliberately.
const contextLabels = new Set([
  'Account',
  'Branding',
  'CLEAN',
  'Contact',
  'Demo',
  'DemoRequest',
  'Document',
  'FORECAST_CAPTURE_FAILED',
  'First touch from linked Trade Show Lead',
  'Gmail profile lookup',
  'INCOMPATIBLE_SOURCE',
  'Internal domain',
  'MISSING_HISTORICAL_SOURCE',
  'MISSING_PRICE',
  'MarketingCampaign',
  'Module',
  'NOTE_PRICE',
  'NOTE_TARIFF',
  'OAuth state/PKCE validation',
  'OPPORTUNITY',
  'OPPORTUNITY_CAPTURE_FAILED',
  'Opportunity',
  'Opportunity Stage',
  'PRICE_EXCEPTION',
  'PriceException',
  'Project',
  'STRUCTURED_TARIFF',
  'SUPPORT_CASE',
  'SYNC',
  'SalesPlanLine',
  'Stage',
  'SupportAttachment',
  'SupportCase',
  'TASK',
  'Trade Show',
  'Trade Show Lead',
  'Trade Show import',
  'TradeShow',
  'Trusted domain',
  'User',
  'account',
  'account.archive',
  'account.save',
  'attachment-compensation',
  'attachment-delete',
  'attachment-metadata-delete',
  'authentication',
  'branding-logo-retire',
  'branding-logo.read',
  'branding-logo.reset',
  'branding-logo.upload',
  'busy',
  'calendar-oauth.callback',
  'calendar-sync',
  'completion',
  'contact.save',
  'contact.state',
  'create-review',
  'create-save',
  'demo.assign-owner',
  'demo.deploy-units',
  'demo.expected-return',
  'demo.record-return',
  'demo.update-context',
  'demo.update-notes',
  'document-storage',
  'document.authorize',
  'document.download',
  'document.upload',
  'domain-policy',
  'email',
  'encrypted credential save',
  'environment/config validation',
  'expected mailbox validation',
  'file-import',
  'file-review',
  'forbidden',
  'forecast-snapshot.confirm',
  'forecast-snapshot.preview',
  'google-calendar',
  'google-sign-in',
  'ignore',
  'import.confirm',
  'import.preview',
  'inactive',
  'inbox',
  'insufficient-scope',
  'integration-history',
  'invalid',
  'invalid-grant',
  'invalid-job-secret',
  'invalid-token',
  'link',
  'marketing.campaign-archive',
  'marketing.campaign-save',
  'marketing.lead-source-save',
  'network',
  'not-found',
  'notification-evaluator',
  'oauth-callback',
  'oauth-client',
  'opportunity',
  'opportunity-snapshot.confirm',
  'opportunity-snapshot.preview',
  'opportunity.archive',
  'opportunity.save',
  'price-exception.assign-rep',
  'price-exception.expire',
  'price-exception.follow-up',
  'price-exception.resolve-accounts',
  'profile',
  'project',
  'project.archive',
  'project.save',
  'quota',
  'rate-limit',
  'read',
  'reauth',
  'request-failed',
  'restore',
  'sales-plan.allocate',
  'setting.save',
  'support-attachment.authorize',
  'support-attachment.download',
  'support-attachment.remove',
  'support-attachment.upload',
  'support-case.archive',
  'support-case.file-import',
  'support-case.file-import-report',
  'support-case.save',
  'support-email-file-cleanup',
  'support-gmail',
  'timeout',
  'token exchange',
  'token-refresh',
  'trade-show.archive',
  'trade-show.save',
  'transient',
  'unapproved',
  'unknown',
  'untrusted-domain',
  'upload-compensation',
  'user.export',
  'user.google-identity-reset',
  'user.save',
  'weekly-snapshots',
  'workspace',
]);
const numericKeys = new Set(['userId', 'entityId', 'runId', 'durationMs', 'status', 'processed', 'succeeded', 'skipped', 'failed', 'created', 'resolved']);
export function sanitizeContext(context: unknown): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  try {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return output;
    // Inspect a fixed number of keys without invoking getters, toJSON or recursion.
    for (const key of allowedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(context, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const value: unknown = descriptor.value;
      if (numericKeys.has(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) output[key] = value;
      else if ((key === 'requestId' || key === 'correlationId' || key === 'runId') && typeof value === 'string' && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)) output[key] = value.toLowerCase();
      else if (!numericKeys.has(key) && typeof value === 'string' && contextLabels.has(value)) output[key] = value;
    }
    // Fixed secret aliases only: arbitrary key names can themselves contain private text.
    for (const key of ['password', 'token', 'accessToken', 'refreshToken', 'authorization', 'cookie', 'secret', 'clientSecret', 'databaseUrl']) {
      if (Object.hasOwn(context, key)) output[key] = REDACTED;
    }
  } catch { return {}; }
  return output;
}

export function normalizeError(error: unknown) {
  try {
    if (!error || typeof error !== 'object') return { errorClass: 'UnknownError', message: 'Unexpected failure' };
    const value = error as { name?: unknown; code?: unknown; stack?: unknown; cause?: unknown };
    const errorClass = safeErrorClass(value.name) ?? 'UnknownError';
    const errorCode = typeof value.code === 'string' && /^(P\d{4}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENOENT|EACCES|ENOSPC|ERR_INVALID_ARG_TYPE|ERR_INVALID_URL|ERR_HTTP_HEADERS_SENT|ERR_STREAM_DESTROYED|ERR_STREAM_WRITE_AFTER_END|ERR_TLS_CERT_ALTNAME_INVALID)$/.test(value.code) ? value.code : undefined;
    const causeClass = value.cause && typeof value.cause === 'object' ? safeErrorClass((value.cause as { name?: unknown }).name) : undefined;
    // Error messages can contain SQL, provider responses and credentials. Keep frames only.
    const stack = typeof value.stack === 'string' ? value.stack.slice(0, 16000).split('\n').slice(1, 13).filter(line => /^\s+at (?:[\w.<>]+ \()?(?:\/[^\s():@?=]+|node:[^\s():@?=]+):\d+:\d+\)?$/.test(line)).join('\n').slice(0, 2500) : undefined;
    return { errorClass, message: 'Unexpected failure', ...(errorCode ? { errorCode } : {}), ...(causeClass ? { causeClass } : {}), ...(stack ? { stack } : {}) };
  } catch { return { errorClass: 'UnknownError', message: 'Unexpected failure' }; }
}

export function isExpectedError(error: unknown) {
  try {
    if (!error || typeof error !== 'object') return false;
    const value = error as { name?: unknown; code?: unknown; message?: unknown };
    // Gmail operational failures already emit a safe integration warning at the provider boundary.
    if (value.name === 'SupportGmailHttpError') return true;
    if (value.name === 'RecordChangedError' || value.code === 'P2002' || value.code === 'P2025') return true;
    if (value.name !== 'Error' || value.code !== undefined) return false;
    if (typeof value.message === 'string' && new Set(['Support Gmail request timed out. Try again.', 'Support Gmail connection failed. Try again.', 'The selected file is empty.', 'Documents must be 25 MB or smaller.', 'Unsupported file type. Upload a PDF or Microsoft Office document.', 'The file extension and content type do not match.', 'The file contents do not match the selected file type.', 'Description must be 2,000 characters or fewer.', 'Documents cannot be changed on an archived record.', 'File is too large. Maximum size is 25 MB.', 'File is too large or incomplete.', 'File type is not supported.', 'Logo must be 1 MB or smaller.', 'The image contents do not match its file type.', 'Price Exception is no longer eligible to be marked Expired.', 'Price Exception changed. Refresh and try again.', 'Sales cannot reassign follow-up ownership.', 'Follow-up owner must be an eligible Sales user who can view this Price Exception.', 'A PE cannot replace itself.', 'Replacement PE not found or not permitted.', 'Follow-up text is too long.']).has(value.message)) return true;
    return typeof value.message === 'string' && /^(Access denied|Administrator access required|Permission denied|Not found|Invalid (?!URL|time value|regular expression|argument|state|response|JSON)|Choose |Select |Please |Enter |Allocation |Unknown (setting|label)|That email address is already in use|Keep at least one active|Only an Administrator|User Administration Access requires|This record changed|This plan is not eligible|This annual measure is not present|Module unavailable|Reactivate|Preview changed|Case not found|Support Case not found|Attachment not found|Attachments cannot|Email intake can only|Resolution Summary |Only a Support |Subject, description|Restore the case|This message |This email |This Gmail thread|\w+ is too long\.|(?:Account|Contact|Opportunity|Project|User|Document|Document parent|Price Exception) not found\.?$)/i.test(value.message);
  } catch { return false; }
}

function emit(level: LogLevel, event: string, context: LogContext = {}, error?: unknown) {
  try {
    if (level === 'debug' && process.env.NODE_ENV === 'production') return;
    const safeEvent = ['job.started', 'job.completed', 'job.failed', 'action.failed', 'request.failed', 'integration.failed', 'integration.activity', 'auth.denied'].includes(event) ? event : 'logging.invalid_event';
    const normalized = level === 'error' ? normalizeError(error) : undefined;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event: safeEvent,
      message: normalized?.message ?? safeEvent, ...sanitizeContext(context),
      ...(normalized ? { errorClass: normalized.errorClass, ...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}), ...(normalized.causeClass ? { causeClass: normalized.causeClass } : {}), ...(normalized.stack ? { stack: normalized.stack } : {}) } : {}) });
    if (level === 'error') console.error(line);
    else console.log(line);
  } catch {
    try { process.stderr.write('{"level":"error","event":"logging.failed","message":"Logging failed"}\n'); } catch { /* Logging must never affect application behavior. */ }
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => emit('debug', event, context),
  info: (event: string, context?: LogContext) => emit('info', event, context),
  warn: (event: string, context?: LogContext) => emit('warn', event, context),
  error: (event: string, error: unknown, context?: LogContext) => emit('error', event, context, error),
};

const deniedJobWarnings = new Map<string, { at: number; suppressed: number }>();
export function warnSecurityDenial(operation: string, reason: string, requestId?: string) {
  if (!['calendar-sync', 'notification-evaluator', 'weekly-snapshots', 'google-sign-in'].includes(operation) || !['invalid-job-secret', 'untrusted-domain'].includes(reason)) return;
  const key = `${operation}:${reason}`;
  const now = Date.now();
  const previous = deniedJobWarnings.get(key);
  if (previous && now - previous.at < 300_000) { previous.suppressed++; return; }
  deniedJobWarnings.set(key, { at: now, suppressed: 0 });
  logger.warn('auth.denied', { operation, reason, requestId, ...(previous?.suppressed ? { skipped: previous.suppressed } : {}) });
}
export function warnInvalidJobSecret(operation: string) {
  warnSecurityDenial(operation, 'invalid-job-secret');
}

export function logUnexpectedOnce(event: string, error: unknown, context: LogContext = {}, force = false, recorded?: WeakSet<object>) {
  if (!force && isExpectedError(error)) return false;
  if (error && typeof error === 'object') {
    if (recorded?.has(error)) return false;
    recorded?.add(error);
  }
  logger.error(event, error, context);
  return true;
}

export function incidentMessage(requestId: string) { return `Something went wrong. Reference: ${requestId}`; }

export function jobLogger(jobName: string, requestId: string = newCorrelationId()) {
  const started = Date.now();
  const context = { jobName, requestId };
  let terminal = false;
  const finish = () => { if (terminal) return false; terminal = true; return true; };
  logger.info('job.started', context);
  return {
    requestId,
    completed: (counts: LogContext = {}) => finish() && logger.info('job.completed', { ...context, durationMs: Math.max(0, Date.now() - started), ...sanitizeContext(counts) }),
    failedOutcome: (counts: LogContext = {}) => finish() && logger.warn('job.failed', { ...context, durationMs: Math.max(0, Date.now() - started), ...sanitizeContext(counts) }),
    failed: (error: unknown, counts: LogContext = {}) => {
      if (!finish()) return;
      const details = { ...context, durationMs: Math.max(0, Date.now() - started), ...sanitizeContext(counts) };
      if (!logUnexpectedOnce('job.failed', error, details, true)) logger.warn('job.failed', details);
    },
  };
}
