# Durable integration and job history v1

Admins open **Maintenance History → Integration & Job History**, or **System Health → Integration & Job History → Review history**. This is stored operational evidence from real actions. Opening these sections never polls Google or starts jobs. `/api/health` remains a basic web-service check and does not verify provider health. Existing database/storage health checks remain unchanged.

## Ledger and deployment

Migration `20261018010000_integration_attempt_history` adds nullable operation, opaque context hash, actor ID, service identity, Case ID, Calendar connection ID and a fixture flag to `ScheduledJobRun`, with context/time indexes. It preserves every existing job and snapshot row. Apply through the normal reviewed migration process before enabling writers. This work does not migrate or deploy production.

Weekly automation continues to write exactly its existing `ScheduledJobRun` attempt, including Opportunity/Forecast run IDs, intended week, safe capture failures and service attribution. No copy, backfill, or second snapshot history exists. Existing Calendar scheduler and notification evaluator runs also appear, labeled separately from individual Calendar connection syncs. Their existing best-effort scheduler instrumentation is unchanged.

Gmail/Calendar writers await the start row before operational work; if it cannot be saved, that action does not start. Completion is awaited. A completion-write failure logs one fixed diagnostic and leaves a **Running / Completion not recorded** row; it cannot reverse already committed CRM work. A crash has the same observable outcome. Such a row is incomplete evidence, never assumed successful or automatically converted to a failure. Recoveries are derived on read, so there is no separate recovery update that can be lost.

Actor and CRM reference IDs deliberately have no new foreign keys, preserving operational evidence after connection or user cleanup. Current actor names are resolved at read time, with `User #ID` for missing users; services have fixed labels. Deleting a Calendar connection does not erase its attempts. Existing snapshot foreign keys and immutability rules remain intact.

## Coverage

| Integration | Recorded operations | Context used for recovery |
| --- | --- | --- |
| Support Gmail | Inbox fetch/refresh requested by an authorized inbox visit, create case from email, link email to case, ignore, restore, each selected attachment import, validated connect/reconnect callback, disconnect | Same operation and mailbox plus inbox, email thread for case creation, message for link/ignore/restore, message/part and Case for import, or connection action. Context identifiers are hashed; Case IDs remain available for navigation. |
| Google Calendar | Each existing manual or scheduled connection sync: start, success, connection/reconnect failure, provider/network/deadline failure, partial sync failure, busy/locally bounded invocation | Same connection ID, owner ID and primary calendar; manual and scheduled retries can recover one another. A recreated connection has a new context. |
| Weekly snapshots | Existing automation attempts, including capture failures, retry/reuse outcomes and exact Opportunity/Forecast links | Same intended snapshot week. A successful capture for another week does not recover an earlier failure. |
| Existing schedulers | Existing Calendar scheduler aggregate and notification evaluator runs | Same scheduler type. Aggregate scheduler recovery never recovers individual Calendar connection failures. |

Gmail remains read-only. Ignore/restore affect SalesHub records only. No mailbox polling, mailbox mutation, automatic attachment import, or extra provider read is introduced. An inbox action can use the existing short-lived cache; success means that SalesHub action completed, not that every visit made a fresh provider request. Review/preview reads alone are not additional attempt types. Invalid/declined OAuth callbacks are excluded; validated callbacks reaching the exchange are recorded. Invalid unsigned case-intake submissions do not create provider attempts. Fixture operations are visibly labeled and cannot recover live failures or contribute to durable System Health.

Attachment attempts are per selected file, including idempotent already-imported outcomes. A partial batch therefore has both successful and failed entries. Its unrelated successful files cannot recover the failed selection. Existing Case attachment lifecycle reports remain unchanged and are not copied into the operational ledger.

Calendar requests have a ten-second deadline, a two-minute overall per-connection deadline, and at most 100 pages per scan. No automatic request retries are added; expired sync-token recovery remains one fresh bounded scan within the same deadline. Applied events remain intact after a later page fails, and the final sync token advances only after complete success. A failed sync may have applied some events; retrying follows the existing idempotent sync behavior. These limits bound provider work; they cannot interrupt a stalled database call. Calendar connection ownership, read scope, and real authenticated identity during impersonation are unchanged.

## Safe failures and privacy

Shared categories are **Authentication required, Permission issue, Rate limited, Quota reached, Provider unavailable, Network/timeout, Configuration issue, Local throttling, Not found, Unknown failure**. Gmail reuses its existing classifier; scope and provider-policy denials map to Permission issue, token expiry to Authentication required, quota remains distinguishable from rate limits, and network/deadline failures remain distinguishable from provider failures. Calendar maps request status/credential failures internally; Admins see fixed business messages. Snapshot-specific capture/source categories keep their existing safe meaning.

Only fixed categories and messages are persisted by the new writers. The ledger never receives result objects or caught exception text. It does not receive OAuth tokens, secrets, credentials, provider bodies, stacks, message subjects/bodies, attachment names/content, Calendar titles/attendees, authorization codes, signed email grants, or full provider URLs. Views select curated metadata and generate messages from the allowlist; existing free-form scheduler summaries are never selected or rendered. Opaque context hashes contain only operational IDs, not credentials or content. Do not extend this model with arbitrary JSON payloads or exception strings.

## Recovery semantics

- **Failed:** a completed failure with no qualifying later success. It remains unresolved even if another operation, file, connection, week or fixture succeeds.
- **Recovered:** the failure is preserved and references the first qualifying successful attempt. Its success must start after the failure completed, with a greater attempt ID, matching integration, operation, context and fixture/live mode. Concurrent successes are conservatively excluded.
- **Successful:** that operation completed successfully. It does not certify the current authorization or the entire integration.
- **Running:** no completion was recorded; it may be active or interrupted. Review timestamps and perform the intended action again when appropriate.

Reconnect alone does not recover a failed fetch or sync. The intended operation must succeed afterward. There is no manual-resolution control in v1 because the covered flows have no existing operational resolution decision to reuse. Manually created snapshots do not prove weekly automation completed; a later weekly invocation must validate/reuse the exact intended captures. Status is derived from evidence even when a recovery is outside the selected date range. Recovery links open the precise successful attempt.

## Admin workflow and permissions

Filter by integration/job, status, inclusive UTC date range, and user or system/service. Results are 25 rows per page with deterministic ordering and a consistent count. Displayed timestamps use Eastern time. Open a linked Case or snapshot for context; deleted source records may no longer be available. Calendar connection IDs identify a sync target and match the IDs beside current owners in System Health, without granting management access to somebody else's connection.

Start with the most recent unresolved failure in System Health, then review its history and fixed category. Reconnect for authentication failures, review granted access/provider policy for permissions, wait for rate limits or temporary provider/network failures, and inspect exact source/run links for snapshot failures. Retry through the existing integration or scheduler workflow. Check that the intended action succeeded and that the original failure now reads Recovered. Older history cannot reconstruct unrecorded pre-feature failures. No automatic retry or run controls are added to these Admin pages.

Both history and durable health require `users.manage` for the effective active, unarchived user. Test as user removes access when the effective role is not Admin. Provider-management permissions are unchanged. Personal Calendar operations continue to use the real authenticated Google identity; Gmail retains both existing effective-role and real-user connection checks.

## Retention and growth

V1 retains all existing and new attempts; there is no cleanup task and no silent deletion. Rows contain small metadata only. Each inbox visit contributes one row, each explicit email action one row, and each selected attachment one row. Calendar volume follows the existing schedule: a 15-minute cadence is about 35,040 connection attempts per connected user per year, plus 35,040 scheduler aggregate rows per year. Ten continuously connected users therefore produce about 385,440 Calendar rows per year. Weekly automation contributes about 52 rows per year plus explicit retries; notification evaluator rows retain their existing cadence.

Review actual table growth at **250,000 rows, 250 MiB of table/index storage, or six months**, whichever comes first. System Health already shows database/table sizes; maintainers can count this ledger in a read-only database review. This is a documented review threshold, not an automated alarm or deletion threshold. Before cleanup is introduced, the owner must choose the retention horizon and archive location. A future policy should preserve recent history (proposed minimum 12 months), all unresolved failures, incomplete attempts under review, and the successes needed to substantiate retained recovery references. Never delete a recovery anchor while retaining its failure. Retention approval is deferred; it does not block v1 recording or viewing.

## Implementation file inventory

### Ledger and integration services

- `app/lib/admin-integration-history.ts`
- `app/lib/calendar-request.ts`
- `app/lib/google-calendar-oauth.ts`
- `app/lib/google-calendar-sync.ts`
- `app/lib/integration-attempts.ts`
- `app/lib/support-email-file-import.ts`
- `app/lib/support-gmail-connection.ts`
- `app/prisma/migrations/20261018010000_integration_attempt_history/migration.sql`
- `app/prisma/schema.prisma`

### Admin views and action entry points

- `app/app/administration/maintenance-history/page.tsx`
- `app/app/administration/system-health/page.tsx`
- `app/app/my-integrations/actions.ts`
- `app/app/support/cases/actions.ts`
- `app/app/support/inbox/actions.ts`
- `app/app/support/inbox/page.tsx`
- `app/components/admin-audit-page.tsx`
- `app/components/admin-integration-health.tsx`
- `app/components/admin-integration-history.tsx`
- `app/components/durable-integration-health.tsx`

### Tests and migration verification

- `app/e2e/integration-history.spec.ts`
- `app/scripts/test-migrations.py`
- `app/tests/google-calendar-sync.test.mjs`
- `app/tests/integration-attempts.test.mjs`
- `app/tests/support-case-form-state.test.mjs`
- `app/tests/support-email-files.test.mjs`
- `app/tests/support-gmail-errors.test.mjs`
- `app/tests/support-gmail-optimization.test.mjs`
- `app/tests/support-gmail-test-helpers.mjs`
- `app/tests/ux-pilot-polish.test.mjs`

### Help, documentation and release notes

- `CHANGELOG.md`
- `app/docs/administration-audit.md`
- `app/docs/google-calendar-connection.md`
- `app/docs/integration-attempt-history.md`
- `app/docs/system-health.md`
- `app/lib/help/topics.ts`
- `docs/weekly-snapshot-automation.md`

## Validation record (2026-10-17–18)

- `npm run lint`: passed.
- `npm run typecheck`: passed; the final production build also completed TypeScript validation.
- Full unit suite with two test workers: 1,302 passed, one existing fixture-dependent SQL test skipped, zero failures. Nine focused Gmail/Calendar/snapshot/history test files passed again after the final deadline and error-handling refinements.
- Relevant Playwright suite: 25 passed across integration history, Support email intake/recovery and weekly snapshots. Eight final history checks also passed after display hardening, including actual Test as user denial. Desktop 1440px, tablet 768px and phone 390px layouts had no horizontal overflow. Case, Forecast Snapshot and recovery references are covered.
- `python3 app/scripts/test-migrations.py`: all migration tests passed in disposable PostgreSQL containers, including fresh replay, populated upgrade, row fingerprints, existing job/snapshot preservation, repeat deployment, schema parity and compatibility checks. Disposable resources were removed by the test script.
- `npm run build -- --webpack`: passed. The sandboxed attempt could not run the TypeScript configuration child process; approved local execution completed the build. No build configuration was changed.
- `git diff --check` and whitespace checks on new files: passed. Generated Next.js environment/configuration files were restored after validation.

The earlier broad test run exposed a stale Task-filter source assertion; it now checks the existing extracted `TaskDuePeriod` component. Updated integration test fixtures provide the real attempt delegate rather than bypassing history writes. No Task behavior changed. The first browser pass exposed an out-of-range historical fixture year and screenshot caret changes before hydration; corrected fixtures and stable screenshot capture passed the reruns. Two unrelated test files that failed under the initial concurrent validation load passed independently and in the bounded full run.

Screenshots remain in `app/reports/integration-history/` for history and System Health at all three sizes. Validation used the isolated E2E database and synthetic provider fixtures. Production schema/data, provider connections, OAuth configuration, DigitalOcean, commits and pushes were not changed. The production migration still requires the normal reviewed deployment process.

## Presentation and diagnostics

System Health summarizes recorded actions and jobs; fixture attempts remain excluded from its durable status. Test fixtures are shown only where the existing history policy permits them and cannot recover live failures. The UI keeps database diagnostics and capture timestamps in disclosures. Snapshot links use the existing Administration list with a selected snapshot parameter, so captures older than the twelve recent entries can still be reviewed. This presentation change does not write, recapture, backfill, or reinterpret history.
