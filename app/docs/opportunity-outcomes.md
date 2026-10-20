# Opportunity Outcomes & Actual Close v1

## Data and migration

Forward-only migration: `20261016120000_opportunity_outcomes`.

`Opportunity.actualCloseDate` is a nullable PostgreSQL DATE, independent of the existing `expectedCloseDate`. `outcomeReasonId` restricts deletion of referenced `OutcomeReason` rows. `outcomeReasonName` stores the selected label so later Admin renames do not change its historical meaning. Optional `outcomeNotes` is limited to 2,000 characters. No live Opportunities or snapshots are backfilled, including legacy closed records. Unknown means null; neither expected dates nor timestamps supply actual dates.

`OutcomeReason` has a stable ID, name, fixed Won/Lost type (`isWon`), active flag, and sort order. Administration → Outcome Reasons follows the Competitors form pattern and requires `users.manage` (Admin only), including mutation service checks. Add, rename, activate/deactivate, and numeric reorder are supported. No hard-delete operation is exposed. Names are checked case-insensitively within each type. A reason's type cannot change; add a new reason instead. Existing selections retain their original label and remain editable after deactivation; new selections require an active reason.

Initial Lost reasons: Lost to competitor; Price; Product / feature fit; Customer stayed with incumbent; Project cancelled; Budget unavailable; Project delayed / postponed; No decision; Customer unresponsive; Other.

Initial Won reasons: Replaced competitor; New deployment / new business; Existing customer expansion; Product upgrade / replacement; Partner / reseller win; Other.

## State transitions

- Open → closed, creation directly in a closed stage, and Won ↔ Lost require an explicit Actual Close Date and an active reason of the matching type. Notes are optional. Server validation applies to the shared save service and runs inside the transaction before writes.
- The form reveals the outcome section when a closed stage is chosen. Open → closed defaults the date to SalesHub's existing America/New_York business date (`businessToday`); the user can edit it. Date-only parsing and UTC calendar display prevent browser/user timezone shifts, including around DST. Historical unknown dates are never defaulted on initial edit.
- Closed → open clears all four current outcome columns, while capturing the previous closure in history. The next close collects a fresh date/reason/notes. Saving a form which changes between Won and Lost requires a reason matching the new state.
- Unrelated edits to a legacy closed Opportunity may preserve null outcomes. Starting to fill or change its outcome requires both date and reason. Existing completed closures can be corrected with the existing Opportunity edit permission; a retained deactivated reason is allowed. Clearing required data from a completed closure is rejected.
- An optimistic `updatedAt` predicate prevents a concurrent save from overwriting a transition read earlier in the transaction.
- A used Sales Stage cannot change its open/Won/Lost classification: that would bypass outcome validation or clear current-state truth without recording transitions. Rename, activation and ordering remain supported. Add a new stage and move Opportunities individually when changing classification.

Existing effective-user authorization remains authoritative. Sales can read cross-owner records, edit only their own Opportunities, and cannot use this workflow to reassign another owner's deal. Sales Managers and Admins retain their existing edit rights. Outcome Reason administration grants no forecast, commission, revenue or ownership rights. Impersonation uses the effective role and owner.

## History and audit

`OpportunityHistoryEvent` and `OpportunityHistoryArchive` add nullable `oldOutcome`/`newOutcome` JSON containing status, date-only actual close value, stable reason ID, selected label and notes. `CLOSED`, `OUTCOME_REOPENED`, and `OUTCOME_UPDATED` capture full before/after context atomically with the save. Ordinary stage/category/expected-date history remains intact. Business labels display the actual date, reason and notes without internal IDs. Archive/restore copies the new context, converting nullable JSON correctly for Prisma writes.

Admin Audit History categorizes these events as Outcome and displays status, actual date and reason. Notes remain readable in Opportunity History; the cross-entity Admin report continues to omit free-text notes by design. Archiving/reactivating a record remains separate from reopening its sales stage.

## Reporting and snapshots

`opportunityOutcomeWhere` is the reusable filter foundation. `OpportunityFilters`/`opportunityWhere`/`listOpportunities` accept `actualCloseFrom`, `actualCloseTo` (inclusive calendar dates), `outcomeStatus` (`won`/`lost`/`open`) and stable `outcomeReasonId`, alongside the existing `ownerId`. These compose with existing visibility and permission scopes. Invalid actual-date ranges fail rather than silently changing the query. Nullable legacy dates naturally fall outside actual-date ranges. Indexes cover actual date + owner and reason + actual date. No scoring, new analytics suite, or report-builder controls were added. Closed detail views and list rows expose recorded dates and reason labels; the list distinguishes Expected close date from Actual close date.

Opportunity Snapshots remain immutable and preserve Expected Close Date, owner, stage, category, values and capture context. They do not gain outcome columns in v1. Forecast Snapshot History derives its quarterly placement, including Closed Won at capture, from the snapshot's Expected Close Date. Weekly ForecastSnapshot captures preserve their existing totals/targets behavior. Current forecast queries also continue to use Expected Close Date. No historical snapshots, aggregation rules, owner attribution, or forecast metrics are rewritten.

Pipeline Movement → History & Outcomes now compares historical snapshot context with recorded outcomes. Further actual-revenue reporting would need additional policy. Decide explicitly whether a future report measures the latest closure or individual closure events after reopen, and how legacy unknowns are excluded/reported. For period-based actual wins, use Actual Close Date in a separate actual-outcomes query; version any future snapshot/report semantic change instead of reinterpreting existing Closed Won forecast buckets. Immutable closure history can support event-based comparisons when reopened deals make current fields null. Actuals may also need value-at-close and owner-at-close policy before revenue or accuracy scoring; this build does not define revenue recognition or alter attribution.

## Validation and follow-up

### Opportunity Outcome Filters & Saved Views v1

The Opportunity list’s expandable Outcome filters section exposes Open/Won/Lost, Actual Close Date From/Through, and configured Outcome Reasons, including inactive reasons. Open and closed states use Sales Stage flags. Reason choices narrow to the selected outcome; changing the outcome clears an incompatible reason. Renamed reasons filter by stable ID, while closed rows retain the reason label saved on the deal. Unknown legacy actual dates display “Not recorded”; an actual-date range excludes those nulls.

The shared outcome helper supplies server-side criteria to both counts and paginated rows, with the existing Expected Close Date/ID ordering. Actual bounds are inclusive date-only values at UTC midnight, matching outcome storage; they are not converted through a personal time zone. Expected Close Period retains its existing New York quarter semantics. Selecting both ranges intersects them. Invalid or reversed actual ranges show an inline message. Saved Views retain all four outcome keys without changing older views, permissions, or reset policy. Actual-date ranges count once; status and reason each count once.

No migration, Outcome Notes search, new report, automatic Saved Views, or permission change is included. Pipeline Movement History & Outcomes remains the analytical destination.

Focused unit tests cover transition validation, legacy nulls, matching reasons, inactive/renamed labels, notes, date rollover, New York/DST boundaries, query composition, Admin permissions, impersonation and stage configuration bypass prevention. `e2e/opportunity-outcomes.spec.ts` adds real transaction/history/archive tests, UI close/reopen/re-close, Admin management, effective-role permissions, and screenshot/overflow checks at desktop (1440), tablet (768), and phone (390) widths. Migration replay tests fingerprint all preexisting tables, exclude only the added null columns, verify no fabricated outcomes, all 16 defaults, restrictive FK behavior and full schema parity.

No broad Help rewrite is part of v1. Existing Help's Expected Close Date and snapshot explanations remain accurate; no correction was necessary. The next consolidated Help pass should cover Sales cross-owner visibility, My Pipeline, expected versus actual dates, Won/Lost reasons, short optional notes, reopening, and the future reporting purpose.

## Preexisting validation finding

The `20261014170000_support_outbound_email_logging` migration replaced `Activity_parent_check` with Account/Opportunity/Support Case parents and omitted Project. As a result, a Project-only Activity is currently rejected even though older migrations allowed it. This outcome build does not rewrite that applied migration or change Activity policy. The replay harness's Project-link fixture now supplies its Project's Account as well, so the fixture obeys the current constraint while still testing Project linkage. Restore Project-only support in a separate forward migration if that remains the intended Activity policy. The Activity relationship smoke fixture also now supplies an eligible responsible Sales user, satisfying the existing service requirement before relationship validation.

## Changed files

Paths below are relative to `app/`.

- Schema/migration: `prisma/schema.prisma`; `prisma/migrations/20261016120000_opportunity_outcomes/migration.sql`.
- Outcome and query services: `lib/opportunity-outcomes.ts`; `lib/outcome-reasons.ts`; `lib/opportunities.ts`.
- History/audit: `lib/opportunity-history.ts`; `lib/admin-audit.ts`.
- Form serialization/recovery: `lib/opportunity-serialization.ts`; `lib/opportunity-draft.ts`.
- Opportunity presentation: `components/opportunity-form.tsx`; `app/opportunities/[id]/page.tsx`; `app/opportunities/[id]/edit/page.tsx`; `app/opportunities/page.tsx`.
- Administration: `app/administration/page.tsx`; `app/administration/outcome-reasons/page.tsx`; `app/administration/outcome-reasons/actions.ts`; `components/outcome-reason-form.tsx`; `lib/sales-stage-admin.ts`.
- New focused coverage: `tests/opportunity-outcomes.test.mjs`; `e2e/opportunity-outcomes.spec.ts`.
- Existing test updates: `tests/administration-page.test.mjs`; `tests/archive-cutover.test.mjs`; `tests/assignment-eligibility.test.mjs`; `tests/commercial-intelligence.test.mjs`; `tests/configuration.test.mjs`; `tests/contact-relationship-lifecycle.test.mjs`; `tests/opportunity-detail-layout.test.mjs`.
- Migration replay/preservation: `scripts/test-migrations.py`; `prisma/tests/activity-history-smoke.mjs` (supply the now-required responsible user in its relationship-validation fixture).
- Maintainer documentation: `docs/opportunity-outcomes.md`.

## Completed validation (2026-10-16)

- ESLint: passed.
- Typecheck: passed (`npm run typecheck`); production build's TypeScript pass also completed.
- Unit suite: 171/171 test files passed; migration-operation script coverage rerun after harness adjustments also passed.
- Playwright: 7/7 outcome tests passed with `ENABLE_DEV_IMPERSONATION=true`, including all three viewport sizes, screenshots, Admin management and effective-role denial. The 13 existing Opportunity/Opportunity Snapshot/Forecast Snapshot tests also passed. A first-run Admin rename test locator was corrected to use the stable reason ID.
- Production build: passed with `npm run build -- --webpack` outside the sandbox. The default Turbopack attempt was blocked by local build-worker port binding permissions; the repository build configuration is unchanged.
- Migration replay/preservation: full `python3 app/scripts/test-migrations.py` passed across all 76 migrations, including fresh replay, populated upgrade, all preexisting table/snapshot fingerprints, legacy null preservation, default reasons, restrictive FK, archive-compatible schema parity, baseline/revised client compatibility and bad-data rollback checks.
- `git diff --check`: passed.

Only disposable test databases were migrated. No commit, push or deployment was performed. No business-policy decision blocks v1; the future closure-event/actuals attribution decisions described above remain outside this build.
