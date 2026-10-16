export type SupportGmailReadStage = 'token-refresh' | 'profile' | 'read';
type FailureCategory = 'invalid-token' | 'invalid-grant' | 'oauth-client' | 'insufficient-scope' | 'rate-limit' | 'quota' | 'domain-policy' | 'forbidden' | 'not-found' | 'transient' | 'request-failed' | 'network' | 'timeout';

export function logSupportGmailReadFailure(stage: SupportGmailReadStage, status: number | 'none', category: FailureCategory) {
  // Never log URLs, headers, payloads, provider messages or caught exceptions.
  console.error(`[Support Gmail] stage=${stage} status=${status} category=${category}`);
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

export async function throwSupportGmailHttpError(response: Response, stage: SupportGmailReadStage): Promise<never> {
  let payload: Record<string, unknown> = {};
  try { payload = object(await response.json()); } catch { /* Status still determines a safe fallback. */ }
  const error = object(payload.error);
  const reasons = [
    ...(Array.isArray(error.errors) ? error.errors.map(row => object(row).reason) : []),
    ...(Array.isArray(error.details) ? error.details.filter(row => object(row)['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo').map(row => object(row).reason) : []),
  ];
  const has = (...values: string[]) => values.some(value => reasons.includes(value));
  const status = response.status;
  let category: FailureCategory = 'request-failed';
  let message = stage === 'token-refresh' ? 'Support Gmail token refresh failed. Try again later.' : 'Support Gmail read failed. Try again.';
  if (stage === 'token-refresh' && status === 400 && payload.error === 'invalid_grant') {
    category = 'invalid-grant'; message = 'Support Gmail connection expired. Reconnect Gmail.';
  } else if (stage === 'token-refresh' && (status === 400 || status === 401) && ['invalid_client', 'unauthorized_client'].includes(String(payload.error))) {
    category = 'oauth-client'; message = 'Support Gmail OAuth client was rejected. Ask an administrator to check the connection settings.';
  } else if (status === 401) {
    category = 'invalid-token'; message = 'Support Gmail connection expired. Reconnect Gmail.';
  } else if (status === 429 || (status === 403 && has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'))) {
    category = 'rate-limit'; message = 'Support Gmail is rate limited. Try again later.';
  } else if (status === 403 && has('dailyLimitExceeded', 'quotaExceeded', 'QUOTA_EXCEEDED')) {
    category = 'quota'; message = 'Support Gmail quota was exceeded. Try again later or ask an administrator to check Google API usage.';
  } else if (status === 403 && has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    category = 'insufficient-scope'; message = 'Support Gmail read permission is missing.';
  } else if (status === 403 && has('domainPolicy')) {
    category = 'domain-policy'; message = 'Support Gmail access is blocked by Google Workspace policy. Contact your administrator.';
  } else if (status === 403) {
    category = 'forbidden'; message = 'Support Gmail access was denied by Google. Ask an administrator to check mailbox access.';
  } else if (status === 404) {
    category = 'not-found'; message = 'Gmail message not found.';
  } else if (status >= 500) {
    category = 'transient'; message = 'Support Gmail is temporarily unavailable. Try again later.';
  }
  logSupportGmailReadFailure(stage, status, category);
  throw new Error(message);
}
