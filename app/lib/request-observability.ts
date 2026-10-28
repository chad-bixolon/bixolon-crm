import { headers } from 'next/headers';
import { correlationIdFromHeader, incidentMessage, isExpectedError, logUnexpectedOnce, sanitizeContext, newCorrelationId, type LogContext } from './observability';

// Request-owned weak keys cannot retain requests or share deduplication via caller IDs.
const scopes = new WeakMap<object, { requestId: string; recorded: WeakSet<object> }>();
function scopeFor(key: object, header: string | null) {
  let scope = scopes.get(key);
  if (!scope) { scope = { requestId: correlationIdFromHeader(header), recorded: new WeakSet() }; scopes.set(key, scope); }
  return scope;
}
async function currentScope() {
  try { const requestHeaders = await headers(); return scopeFor(requestHeaders, requestHeaders.get('x-request-id')); }
  catch { return { requestId: newCorrelationId(), recorded: new WeakSet<object>() }; }
}
export async function currentRequestId() { return (await currentScope()).requestId; }

export async function captureActionError(error: unknown, operation: string, context: LogContext = {}) {
  if (isExpectedError(error)) return undefined;
  const { requestId, recorded } = await currentScope();
  logUnexpectedOnce('action.failed', error, { ...sanitizeContext(context), operation, requestId }, false, recorded);
  return incidentMessage(requestId);
}

export function requestIdFor(request: Request) { return scopeFor(request, request.headers.get('x-request-id')).requestId; }

export function captureRouteError(request: Request, error: unknown, operation: string, context: LogContext = {}) {
  if (isExpectedError(error)) return undefined;
  const { requestId, recorded } = scopeFor(request, request.headers.get('x-request-id'));
  logUnexpectedOnce('request.failed', error, { ...sanitizeContext(context), operation, requestId }, false, recorded);
  return incidentMessage(requestId);
}
