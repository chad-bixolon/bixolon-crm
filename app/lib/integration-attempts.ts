import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { logUnexpectedOnce } from './observability';

export const failureMessages = {
  AUTHENTICATION: 'Authentication required. Reconnect the integration and retry.',
  PERMISSION: 'Permission issue. Review the granted access and provider policy.',
  RATE_LIMIT: 'Rate limited. Wait before retrying.',
  QUOTA: 'Provider quota reached. Review usage before retrying.',
  PROVIDER: 'Provider unavailable. Try again later.',
  NETWORK: 'Network or request deadline failure. Try again later.',
  CONFIGURATION: 'Configuration issue. Ask an Admin to review integration settings.',
  LOCAL_THROTTLE: 'Local throttling. Wait for the current work to finish and retry.',
  NOT_FOUND: 'The requested provider record was not found. Review the source record.',
  UNKNOWN: 'The operation did not complete. Review the related record before retrying.',
} as const;
export type OperationalFailure = keyof typeof failureMessages;
export const failureLabels: Record<OperationalFailure, string> = { AUTHENTICATION: 'Authentication required', PERMISSION: 'Permission issue', RATE_LIMIT: 'Rate limited', QUOTA: 'Quota reached', PROVIDER: 'Provider unavailable', NETWORK: 'Network/timeout', CONFIGURATION: 'Configuration issue', LOCAL_THROTTLE: 'Local throttling', NOT_FOUND: 'Not found', UNKNOWN: 'Unknown failure' };
export const integrationLabels = { SUPPORT_GMAIL: 'Support Gmail', CALENDAR_CONNECTION_SYNC: 'Google Calendar', WEEKLY_SNAPSHOTS: 'Weekly snapshots', CALENDAR_SYNC: 'Calendar scheduler', NOTIFICATION_EVALUATOR: 'Notification evaluator' } as const;
export const operationLabels = { INBOX_FETCH: 'Inbox fetch / refresh', CREATE_CASE: 'Create case from email', LINK_EMAIL: 'Link email to case', IGNORE: 'Ignore email', RESTORE: 'Restore email', IMPORT_ATTACHMENT: 'Import selected attachment', CONNECT: 'Connect / reconnect', DISCONNECT: 'Disconnect', SYNC: 'Sync Calendar', RUN: 'Run job' } as const;
export type IntegrationOperation = keyof typeof operationLabels;
type Db = Pick<PrismaClient, 'scheduledJobRun'>;
export type AttemptContext = {
  jobType: 'SUPPORT_GMAIL' | 'CALENDAR_CONNECTION_SYNC'; operation: IntegrationOperation;
  contextKey: string; actorId?: number; serviceIdentity?: 'calendar-sync';
  supportCaseId?: number; calendarConnectionId?: number; isTest?: boolean;
};
// Only opaque hashes of operational identifiers; callers must never include content or credentials.
export function attemptContext(...ids: (string | number)[]) { return createHash('sha256').update(JSON.stringify(ids)).digest('hex'); }
export function gmailFailure(error: unknown): OperationalFailure {
  const category = error instanceof Error && error.name === 'SupportGmailHttpError' && 'category' in error ? error.category : null;
  const map: Record<string, OperationalFailure> = { 'invalid-token': 'AUTHENTICATION', 'invalid-grant': 'AUTHENTICATION', 'oauth-client': 'CONFIGURATION', 'insufficient-scope': 'PERMISSION', 'rate-limit': 'RATE_LIMIT', quota: 'QUOTA', 'domain-policy': 'PERMISSION', forbidden: 'PERMISSION', 'not-found': 'NOT_FOUND', transient: 'PROVIDER', network: 'NETWORK', timeout: 'NETWORK' };
  if (typeof category === 'string' && Object.hasOwn(map, category)) return map[category];
  const message = error instanceof Error ? error.message : '';
  if (message === 'Support Gmail is busy. Please try again in a moment.') return 'LOCAL_THROTTLE';
  if (message === 'Support Gmail is rate limited. Try again later.') return 'RATE_LIMIT';
  if (message === 'Gmail message not found.' || message === 'Email file is no longer available.') return 'NOT_FOUND';
  if (message === 'Google must grant only gmail.readonly.') return 'PERMISSION';
  if (['Dedicated Support Gmail OAuth client is required.', 'Connected Gmail account does not match SUPPORT_GMAIL_MAILBOX.'].includes(message)) return 'CONFIGURATION';
  if (['Connect Support Gmail to read the Support inbox.', 'Stored Support Gmail credential is unavailable. Reconnect Gmail.'].includes(message)) return 'AUTHENTICATION';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'NETWORK';
  if (['Support Gmail request timed out. Try again.', 'Support Gmail connection failed. Try again.', 'Support Gmail authorization could not reach Google. Try again.'].includes(message)) return 'NETWORK';
  return 'UNKNOWN';
}
/** Await both writes. Telemetry failure never reverses an already committed CRM action.
 * A failed start prevents the action, avoiding silently unrecorded new attempts. */
export async function beginIntegrationAttempt(db: Db, context: AttemptContext) {
  try { return await db.scheduledJobRun.create({ data: { ...context, status: 'RUNNING' }, select: { id: true } }); }
  catch { throw new Error('Operational history is unavailable. Try again after database service is restored.'); }
}
export async function finishIntegrationAttempt(db: Db, id: number, failure?: OperationalFailure, supportCaseId?: number) {
  try {
    await db.scheduledJobRun.update({ where: { id }, data: { status: failure ? 'FAILED' : 'SUCCEEDED', completedAt: new Date(), failureCategory: failure ?? null, errorSummary: failure ? failureMessages[failure] : null, resultSummary: failure ? null : 'Operation completed.', ...(supportCaseId ? { supportCaseId } : {}) } });
  } catch (error) { logUnexpectedOnce('integration.failed', error, { integration: 'integration-history', operation: 'completion', runId: id }); }
}
export async function trackIntegrationAttempt<T>(db: Db, context: AttemptContext, run: () => Promise<T>, classify = gmailFailure): Promise<T> {
  const attempt = await beginIntegrationAttempt(db, context);
  try { const result = await run(); await finishIntegrationAttempt(db, attempt.id); return result; }
  catch (error) { await finishIntegrationAttempt(db, attempt.id, classify(error)); throw error; }
}
export function gmailContext(operation: IntegrationOperation, mailbox: string, target: string, actorId: number, supportCaseId?: number): AttemptContext {
  return { jobType: 'SUPPORT_GMAIL', operation, contextKey: attemptContext(mailbox, target, supportCaseId ?? ''), actorId, supportCaseId, isTest: process.env.SUPPORT_GMAIL_MOCK === 'true' || process.env.SUPPORT_GMAIL_TEST_FIXTURE === 'true' };
}
