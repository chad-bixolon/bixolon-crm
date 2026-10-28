# Production observability v1

## Audit before implementation

SalesHub had no shared application logger or request ID convention. Runtime `console.error` calls were concentrated in Support Gmail, document and attachment storage, branding cleanup, and integration-history completion. Gmail runtime also printed a fixed `console.info` line for many provider requests; this was noisy in production. The remaining `console.log`/`console.error` uses were mainly operational and test scripts, not request handling.

The application has many explicit catches in actions and route handlers. They fall into these patterns:

| Pattern | Examples | Existing behavior |
| --- | --- | --- |
| Expected validation/business | malformed forms, missing records, duplicate review, stale `P2025` edits, disabled modules | returned form messages or 4xx responses |
| Authorization | mutation permission failures, document/attachment access, invalid job secrets, OAuth state rejection | denial, redirect, or 404 without credential disclosure |
| Dependency/integration | Google OAuth/Gmail/Calendar, object storage, imported files | fixed user messages, some console lines, integration attempt history where available |
| Unexpected application/database | Prisma query failures, transaction failures, internal state errors | often generic fallback or caught exception message, with inconsistent logging |
| Background jobs | weekly snapshots, notification evaluation, Calendar sync | `ScheduledJobRun` status, but no common stdout lifecycle |

The existing `ScheduledJobRun` and integration attempt records remain operational history. This change adds no application-error table or migration.

## Architecture and event format

`lib/observability.ts` is a small synchronous stdout/stderr logger. `info` and `warn` go to stdout, `error` to stderr. Each call writes one JSON line in production, with `timestamp`, `level`, `event`, `message`, and only the supplied safe context fields. `debug` is suppressed in production. Logging performs no network or database call and never writes a file. If serialization or stream writing fails, it tries a minimal fixed fallback and never throws into the request.

```ts
logger.info('job.completed', { jobName: 'calendar-sync', requestId, durationMs: 128, processed: 12 });
logger.warn('integration.failed', { integration: 'support-gmail', operation: 'read', category: 'rate-limit' });
logUnexpectedOnce('action.failed', error, { requestId, operation: 'account.save', userId: actor.id });
```

Events use `area.outcome`: `action.failed`, `request.failed`, `job.started`, `job.completed`, `job.failed`, `integration.failed`, and `auth.denied`. Reuse one of these for another operation; put the stable operation name in `operation`. Add a new event only when it represents a distinct operational outcome that cannot be investigated under an existing category. Do not invent an event for each entity or page.

Example (error message and stack shown here are intentionally fixed/sanitized):

```json
{"timestamp":"2026-10-27T12:00:00.000Z","level":"error","event":"action.failed","message":"Unexpected failure","requestId":"6d6b82c5-3baa-4255-b079-6c224e81cf08","operation":"account.save","userId":17,"entityType":"Account","errorClass":"PrismaClientKnownRequestError","errorCode":"P1001"}
```

## Correlation and error boundaries

The Next proxy accepts a safe incoming `x-request-id` only when it is a UUID or 32-character hexadecimal trace ID; otherwise it generates a UUID. It forwards the ID to the server request and returns it in the response header. Job endpoints are excluded from the proxy and make their own run ID from the same header rule after secret authentication. Server actions use `currentRequestId()` from request headers; route handlers derive it from the `Request`. IDs contain no email, customer, or business data. A valid caller-supplied ID is a correlation hint, not an authentication credential.

At a selected action or route catch, `captureActionError` or `captureRouteError` classifies the error, records unexpected errors once by object identity within its request scope, and returns `Something went wrong. Reference: <requestId>` for a form or JSON response. Known validation, stale-edit, conflict and permission errors keep their existing handling. Prisma `P2002` and `P2025` are expected where caught; other Prisma codes are unexpected and only the safe code is logged. Avoid logging again when an exception propagates to another boundary. Some framework-render failures and action paths outside the selected boundaries still rely on framework diagnostics; expand coverage as those paths are touched.

Unknown exception objects are never serialized directly. Normalization permits the error class, a validated Prisma-style code, a cause class, and bounded stack frames. Raw exception messages are excluded because they can contain provider payloads, SQL, credentials, or business content. User responses never contain stack frames, SQL, or infrastructure details.

## Redaction and privacy

Context uses an allowlist of small scalar fields. Unknown keys, nested objects, arrays, request bodies, query strings, URLs, headers, email content, notes, addresses, phones, CSV rows, descriptions, and uploaded files are dropped. A fixed set of common secret aliases is replaced with `[REDACTED]`; all other unknown keys, including mixed-case and underscore secret spellings, are dropped. Arbitrary key names are never echoed. String values must match the explicit code-owned label catalog or the bounded hexadecimal request ID format. Entity/User IDs and counts must be nonnegative safe integers. Getters and toJSON are not invoked; nested data is not traversed. Adding a label requires code review. Do not log full email addresses; prefer internal User IDs, fixed integration categories, and record IDs already in hand. Never pass full form data, provider responses, Prisma records, or arbitrary error metadata to the logger.

## Jobs and integrations

The authenticated weekly snapshot, notification evaluator, and Calendar sync routes emit `job.started` plus `job.completed` or `job.failed`, with run ID, duration when available, and bounded aggregate counts. Partial Calendar connection failures produce a warning rather than one info line per record. Invalid job-secret attempts emit a fixed `auth.denied` warning without the supplied header. The existing `ScheduledJobRun` behavior remains independent of log writing.

Support Gmail read and OAuth failures emit fixed stage/status/category warnings. Known Gmail HTTP/network failures keep their fixed user message and are not promoted again to an application error at an action boundary. Calendar OAuth callback failures emit `request.failed` with integration and user ID. Document/attachment storage compensation and integration-history completion failures emit safe structured events. Invalid job-secret and rejected Google Workspace sign-in warnings are limited to one event per operation/reason per five-minute process window, with a suppressed count on the next warning. Provider response bodies, tokens, mailbox addresses, OAuth code/state/verifier, storage keys, and full request URLs are excluded. Gmail per-request runtime diagnostics are debug-only and absent from production output.

## DigitalOcean and System Health

DigitalOcean App Platform application logs are the v1 destination. Open the app's Runtime Logs, select the application resource, and inspect available JSON lines by `requestId`, `event`, `operation`, or `jobName`. If needed, retrieve available output with `doctl apps logs <app-id> <component> --type run` and search captured output locally. This is not an indexed historical store. stdout contains lifecycle and warnings; stderr contains unexpected errors. The application does not run a collector or maintain log files. Runtime output is live/bounded; DigitalOcean recommends external forwarding for retention. This feature configures no forwarding. Preserve an available excerpt in the incident record if needed. See [DigitalOcean log documentation](https://docs.digitalocean.com/products/app-platform/how-to/view-logs/).

System Health remains unchanged. It already displays authoritative scheduled-job and integration-attempt evidence. A new “Logging: Operational” label would only report that code is configured, not that DigitalOcean retained or indexed any events. It cannot claim “No recent errors” or search historical production logs without a log API or persistent error store.

## Incident investigation

1. Ask the user for the reference ID shown with the generic failure. For an internal job, use the scheduler time and job name.
2. Open DigitalOcean application Runtime Logs for the application resource and check whether output from the incident time is still available. Historical runtime retention is not guaranteed.
3. Search available/captured output for the exact `requestId` or run ID. An absent line does not establish success or absence of errors.
4. Read the event, operation, safe error class/code, status/category, and entity ID if present.
5. Correlate neighboring `job.started`/`job.completed`/`job.failed` and request/integration events. Timestamps help when a low-level integration event has no request ID.
6. Classify the issue as application logic, database, integration, authorization, or an expected business failure. Use the corresponding existing System Health job/integration evidence when available.

For a new module, return expected validation or stale-edit failures as before. At the catch that owns an unexpected outcome, call the action/route capture helper with a fixed operation and IDs already available. For a recurring job, use `jobLogger` once per execution and log aggregate counts. Add a focused privacy test when adding a new context field. Do not add per-row, per-query, page-render, click, or authorization-success logs.

## Scope and limits

No permissions, ownership rules, module visibility, stale-edit checks, user lifecycle rules, Forecast calculations, Price Exception or Support workflows, Google sign-in rules, trusted domains, database schema, CI policy, or DigitalOcean configuration were changed for observability. The v1 boundaries cover representative high-value mutations and routes; they are not a blanket wrapper around every server action or Next render. Duplicate suppression uses a WeakSet in a request-owned scope, held by a WeakMap keyed by the Request or Next request Headers object. Reusing an error object or incoming ID in another request does not suppress its event. Unscoped helper calls do not deduplicate across invocations. Separate wrappers and framework diagnostics for rethrown action errors can still produce separate events. Low-level integration warnings sometimes have no request ID and require time/operation correlation. This version intentionally has no in-app log viewer or historical error search.

### Correlation limitations

This is request-local correlation, not end-to-end tracing. Redirect responses carry an ID, but the subsequent browser request usually has a new ID. The proxy runs after Auth.js session resolution; failures there or in the proxy before it returns remain framework diagnostics. `/api/auth/*` and scheduled endpoints bypass the proxy. Google sign-in rejection warnings may have a local ID which is not returned or shared across callback stages. Job IDs appear in logs, not response headers. Low-level storage cleanup events may have no request ID.

For covered requests, Next 16.4.3 forwards request headers using `NextResponse.next({ request: { headers } })`; matched Server Action POSTs use the same mechanism. The installed Next headers implementation caches the request-owned Headers object, which anchors local deduplication. Without a usable request context, each helper call creates an independent fallback ID; correlation is not promised across those calls. Request IDs are untrusted hints and cannot establish identity, uniqueness of caller-supplied values, or authorization.

### Review of remaining gaps and volume

Acceptable for v1: framework render failures, authentication/session failures before proxy forwarding, unselected mutation/route catches, and notification processing outside the evaluator retain existing framework diagnostics or durable operational history. Some caught errors have no framework log; these are coverage limits, not a claim of complete capture. Calendar sync and weekly snapshot internals intentionally return categorized failures to their endpoints; their job warning plus System Health/integration history is the available signal, rather than the original exception stack. No further coverage expansion is included.

Routine navigation and successful mutations emit zero application events. Each authorized job emits one start and one terminal event; Calendar partial failures remain aggregate. Invalid secrets and rejected Workspace domains emit at most one warning per operation/reason per five-minute process window (at most eight fixed map entries). A noisy requester can suppress repeats of the same warning category in that window, but cannot suppress other operations/reasons or alter authorization. Counts reappear only on a subsequent warning; restart resets the throttle. Independent compensation/history failures can add events and are separate failures.

The logger is best effort: a reference means capture was attempted, not that DigitalOcean retained the line. Synchronous serialization/write failures attempt a fixed bounded fallback; asynchronous stream errors, process termination and log delivery/retention cannot be guaranteed. Class/code, operation and bounded source frames support initial triage without raw messages; deep provider/database diagnosis may require controlled reproduction. Filtered or minified stacks can be sparse. Legacy framework diagnostics are outside the structured logger's privacy guarantees.
