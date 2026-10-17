# Weekly Opportunity + Forecast Snapshot Automation v1

## Architecture and cadence

The existing snapshot system now has an orchestrator in `app/lib/weekly-snapshots.ts`. It invokes the same preview/capture services as the Admin workflows. There are no scheduler calculations, second snapshot tables, history rewrites, changes to live forecasting, or changes to the legacy aggregate `ForecastSnapshot` feature.

Expected schedule: **Monday at 05:00 America/New_York**, once per Monday–Sunday business week. Use the named timezone, not a fixed UTC offset. This is 09:00 UTC during daylight time and 10:00 UTC during standard time, away from DST transition hours. Week keys use the existing `snapshotWeek` helper; the database supplies the invocation and source transaction timestamps. The scheduler does not backdate live data. No capture happens on a page visit or HTTP GET.

A DigitalOcean scheduled Job runs `node scripts/weekly-snapshots.mjs`, which calls the web service's protected **POST `/api/internal/snapshots/weekly`**. This follows the notification/calendar endpoint pattern and reuses `ScheduledJobRun` for operational history. The Job needs no database credentials. Neither the schedule nor any DigitalOcean resource is installed by this implementation.

## Capture order and quarter selection

1. Persist a RUNNING execution record before making captures. If history cannot be written, fail without starting captures.
2. Look up the intended New York Monday week. Reuse its existing source or preview/capture a **forecast-ready** Opportunity Snapshot through the shared service. The service retains Repeatable Read, fingerprint validation, limits, atomic writes and unique-week protection.
3. Persist its exact ID; require COMPLETE status and `FORECAST_OPERATIONAL_V1` scope. An open-only source is an explicit `INCOMPATIBLE_SOURCE` failure, never upgraded/replaced.
4. Choose **one calendar quarter: `businessQuarter(source.snapshotAt)` in America/New_York**. This matches the manual workflow's current-quarter default at the original capture time. Reuse or capture a Forecast Snapshot for that exact source ID/year/quarter using the shared services.
5. Verify COMPLETE, QUARTERLY_V1, source ID, period and matching historical timestamp. Only then persist SUCCEEDED with both IDs.

Calendar quarters, inclusive start/exclusive next-quarter bounds, Expected Close Date membership, owner eligibility, Closed Won treatment and currency partitioning remain defined by the existing forecast rules. Actual Close Date and structured outcomes are not read for these calculations. No accuracy scoring is introduced.

**Rollover policy limitation:** the existing documentation defines calendar quarters but no “final actual,” final prior-quarter cutoff, or next-quarter forecasting mandate. v1 captures only the quarter at source time, including for a manual source created earlier in the same week. A retry after quarter/year rollover keeps that original quarter. This does not guarantee a capture on the final day of a quarter. If management needs prior-quarter closeout or next-quarter history, the owner must define those additional period/cutoff requirements; do not silently add them. Admins can already capture additional quarters from a compatible immutable source manually.

## Idempotency, manual captures and recovery

The existing database unique keys remain authoritative: one Opportunity source per New York week across both scopes, and one Forecast Snapshot per source/year/quarter. No uniqueness or immutable/complete-run trigger is removed or bypassed. Concurrent invocations may both attempt capture; the loser rereads the committed unique source/forecast and validates it. A RUNNING operational record is not a lock, so process termination cannot strand a weekly capture behind a lock flag.

Every authorized valid invocation gets its own durable `ScheduledJobRun` attempt. A duplicate successful invocation records that it reused existing captures. `createdCount` counts captures created by that invocation, not source Opportunity rows. Reusing a manual source/forecast satisfies the weekly requirement and preserves its manual attribution. Automation can create the missing forecast from a manual forecast-ready source; it never creates a second source for that week.

If Opportunity capture fails, Forecast capture is not attempted. If Forecast capture fails, the completed source remains valid and is linked in the FAILED attempt. Retry rereads that source and creates only the missing forecast. A crash between commit and operational logging is recovered from the immutable snapshot unique keys on the next invocation. An interrupted RUNNING attempt stays as evidence and displays “Interrupted or overdue” after ten minutes; a later attempt does not erase it. If completion logging fails after both commits, retry reconciles the already valid captures. Secrets, provider messages, raw database errors and stack traces are not stored or returned.

The command makes at most three requests, with 5- and 10-second delays, for recorded Opportunity/Forecast failures. It pins retries to the week returned by the first attempt. Incompatible/missing sources, authentication errors and unknown transport outcomes exit nonzero for review. It never prints the token, request headers, origin or raw response. Do not depend on undocumented platform retries; duplicate platform invocations are safe under the same weekly keys.

To recover in the same business week, run the job command once from the scheduled Job's console/environment. Prefer explicitly pinning the intended Monday date:

```sh
node scripts/weekly-snapshots.mjs YYYY-MM-DD
```

This sends `{"week":"YYYY-MM-DD"}` to the protected endpoint. With no argument/body the endpoint selects the current business week. The only accepted input is an optional current/past Monday date; identity, source, quarter and backdate overrides are rejected. Future dates are rejected.

For a past week, recovery requires an already captured forecast-ready source for that week. It can finish the missing Forecast Snapshot using the original source timestamp and quarter. If no source exists, `MISSING_HISTORICAL_SOURCE` records the gap: live data cannot reconstruct a missed historical capture. Capture the current week normally and retain the gap. An open-only weekly source cannot be repaired into forecast-ready history under existing immutability semantics; leave it intact and let the next week capture forecast-ready data. Do not delete snapshots or disable triggers to recover a job.

## Attribution, schema and Admin visibility

`snapshot-capture-identity.ts` defines a server in-process capability checked by object identity. It is not a session role, supplied request identity, employee, or user permission. Only the secret-authenticated route selects this capability. Manual callers retain active Admin checks and their existing confirmation/token/impersonation safeguards.

Automated snapshot runs store `source=SCHEDULED`, `createdById=NULL`, and `createdByName='Automated weekly capture'`. Manual runs keep their real creator ID/name and `source=MANUAL`. Database checks enforce source/ID compatibility. Both creator IDs were already historical scalar IDs without mutable User foreign keys; making them nullable does not introduce a service employee. Existing manual rows remain unchanged; the new Forecast source field defaults to MANUAL.

Migration `20261016230000_weekly_snapshot_automation` makes the two creator IDs nullable, adds Forecast run `source`, adds attribution checks, and extends existing `ScheduledJobRun` with nullable business week, restrictive source/forecast foreign keys and bounded failure category. Existing operational job types retain their behavior. No new snapshot/job-history table is created. Deploy forward through the existing migration process and regenerate Prisma before enabling the trigger. Do not apply this migration to production as part of code preparation.

Administration → Opportunity Snapshots, Forecast Snapshots, and Maintenance History show the latest automation attempt with up to seven earlier attempts in an expandable history, Eastern execution/completion times, intended week, outcome, exact linked snapshot IDs, safe failure category/message and expected cadence. Records remain durable beyond the eight displayed. The current-week status uses a separate successful-execution query, so repeated retries do not hide completion. Manual capture pages remain available. Admin lists and management history pickers distinguish manual/automated captures. System Health and the existing Admin dashboard health summary include the weekly job; its centralized stale threshold is eight days. This is runtime evidence, not proof that an external schedule is configured. The app displays the expected cadence, not an invented next platform invocation timestamp.

## DigitalOcean production configuration (after reviewed deployment)

Follow the existing [application deployment procedure](../app/docs/deployment.md), including production backup, forward migration and Prisma generation. Then configure the following **manually**, after code deployment:

1. Add runtime secret `WEEKLY_SNAPSHOT_SECRET` to the web service and scheduled Job. Use the same cryptographically random value of at least 32 characters. Store it as a DO SECRET, never in an app-spec file or command line. Missing/short/wrong tokens fail closed with 404. Session cookies cannot trigger captures.
2. Add a **Job** component using the same deployed production image/revision as the web service. The production Dockerfile includes the command script at `/app/scripts/weekly-snapshots.mjs`. For repository builds use the web service's existing source/Dockerfile settings; do not invent a second build or infrastructure stack. Override its command with `node scripts/weekly-snapshots.mjs`, working directory `/app`. It must be an on-schedule job, not a deployment hook or continuously running worker.
3. Set Job runtime variable `SALESHUB_JOB_ORIGIN` to the deployed web service's HTTPS origin, for example `https://saleshub.example.com`. No path, credentials, query, fragment or redirect is accepted. Configure network access from the Job to that origin. Only the web service needs `DATABASE_URL`; the trigger script needs the origin and shared secret.
4. In the app spec, the component scheduling portion is:

```yaml
jobs:
  - name: weekly-snapshots
    # Retain the production component's image or repository/build settings.
    kind: SCHEDULED
    run_command: node scripts/weekly-snapshots.mjs
    schedule:
      cron: "0 5 * * 1"
      time_zone: America/New_York
    # Configure the two runtime variables above in DO; no secret value here.
```

DigitalOcean documents `SCHEDULED` jobs and the `schedule.cron`/`schedule.time_zone` app-spec fields in [Manage Cron Jobs and Deployment Jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/#schedule-jobs-using-the-app-spec). Preserve the application's actual image/repository references and required resource settings when adding this fragment. No external scheduler is assumed.

5. Keep the web request timeout and job execution allowance long enough for two 60-second snapshot transactions plus preview reads. The endpoint declares a 300-second duration; the script times out a request at 240 seconds. Platform ingress limits must be verified for the deployed service. A timeout may leave committed snapshots or a RUNNING attempt; retry the same intended week to reconcile. Do not log Authorization headers in ingress/observability tooling.
6. Verify the first job in DO Activity → Jobs, then confirm SUCCEEDED and both linked IDs under Administration. Verify the Opportunity scope is forecast-ready, Forecast source ID matches, period is the source's New York quarter, and automated run attribution is present. A success may reuse an earlier manual capture. Verify System Health shows recent runtime evidence. Routine successful notifications are not added; use existing operational review/DO failure alerts for failures and missed runs.

## Troubleshooting and validation

| Evidence | Meaning/action |
| --- | --- |
| No execution record / 404 | Check schedule, origin, deployed revision and matching runtime secrets without printing them. |
| 400 | Supply only an optional valid current/past Monday `week`. |
| OPPORTUNITY_CAPTURE_FAILED | Check migration/client readiness, database access, capture size limit, or data changing between preview/capture; retry intended week. No forecast attempted unless a concurrent source completed. |
| FORECAST_CAPTURE_FAILED | Source is preserved. Check migration/client readiness and source completeness; retry intended week. |
| INCOMPATIBLE_SOURCE | Existing source lacks forecast data; immutable weekly history cannot be supplemented with another source. Admin review required. |
| MISSING_HISTORICAL_SOURCE | Missed source history cannot be fabricated. Keep the gap. |
| RUNNING older than ten minutes / transport failure | Inspect current snapshots and retry the same Monday date. Do not clear history or delete snapshots. |
| 503 with generic recording error | History/database access was unavailable; actual captures may have committed. Retry the same week to reconcile. |

Focused unit tests exercise both shared services, capture order, partial failure, concurrent duplicates, restart/retry, manual/automated reuse, source validation, timezone/DST and quarter/year rollover, service identity, secret authentication and safe errors. Playwright exercises authenticated recovery/concurrency against the isolated database, immutable automated history, Admin status at 1440/768/390 widths, and role denials. Existing snapshot/manual regression suites remain required. Migration replay includes populated-history preservation, manual attribution and retained immutability, plus schema parity. No production capture/migration/deployment is part of validation.

Validation completed October 16, 2026 (New York), using Node 22.23.3:

- `npm run lint` and `npm run typecheck`: passed after the final UI change.
- `npm test`: 1,282 passed, zero failed, one existing opt-in prospect SQL test skipped (`RUN_PROSPECT_SQL_TEST` unset). This includes manual snapshot, forecast, permissions and impersonation regressions, plus all new automation/command tests.
- Relevant Playwright coverage: 30 existing tests passed across `opportunity-snapshots`, `forecast-snapshots`, `admin`, `admin-audit`, and `operational-maturity` specs. All four new `weekly-snapshots.spec.ts` tests passed in the final targeted run. Desktop 1440×900, tablet 768×1024 and phone 390×844 checks include document overflow, compact status, expandable failures and screenshots under ignored `app/reports/weekly-snapshots/`.
- `python3 app/scripts/test-migrations.py`: all migration tests passed, including fresh replay of 77 migrations, populated upgrade/preservation, schema parity, repeat deployment, the new immutable-history/manual-attribution checks and compatibility/rollback checks. Disposable resources were removed.
- `npm run build -- --webpack`: production build passed, including TypeScript, page generation and build traces.
- `git diff --check`: passed. Generated Next.js configuration changes were excluded from the implementation.

Initial validation was interrupted by workspace disk exhaustion from a generated crash dump; it was removed and later runs disabled core dumps. A screenshot-only hydration warning was fixed by waiting for hydration and using `caret: 'initial'`, while retaining the suite's hydration-error assertions. The final targeted browser run and build passed. Tests used only isolated synthetic databases, never production captures or migrations.

## Implementation file inventory

Paths below are relative to the repository root.

- Orchestration/security: `app/lib/weekly-snapshots.ts`, `app/lib/snapshot-capture-identity.ts`, `app/app/api/internal/snapshots/weekly/route.ts`, `app/proxy.ts`.
- Shared captures/health: `app/lib/opportunity-snapshots.ts`, `app/lib/forecast-snapshots.ts`, `app/lib/scheduled-job-runs.ts`.
- Admin/report UI: `app/components/weekly-snapshot-status.tsx`, `app/components/admin-audit-page.tsx`, `app/app/administration/opportunity-snapshots/page.tsx`, `app/app/administration/forecast-snapshots/page.tsx`, `app/app/administration/system-health/page.tsx`, `app/app/reports/opportunity-snapshots/page.tsx`, `app/app/reports/forecast-snapshots/page.tsx`.
- Schema: `app/prisma/schema.prisma`, `app/prisma/migrations/20261016230000_weekly_snapshot_automation/migration.sql`.
- Runtime/configuration: `app/scripts/weekly-snapshots.mjs`, `app/Dockerfile`, `.env.example`.
- Tests: `app/tests/weekly-snapshots.test.mjs`, `app/tests/weekly-snapshot-route.test.mjs`, `app/tests/weekly-snapshot-command.test.mjs`, `app/e2e/weekly-snapshots.spec.ts`, `app/playwright.config.ts`, `app/scripts/test-migrations.py`.
- Documentation/Help: this guide, `docs/opportunity-snapshots.md`, `docs/forecast-snapshots.md`, `app/docs/deployment.md`, `app/docs/system-health.md`, `app/lib/help/topics.ts`, `CHANGELOG.md`.
