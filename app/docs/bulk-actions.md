# Bulk Actions v1

Tasks, Support Cases, and the three supported Admin Data Quality owner checks offer selection beside eligible rows. Select **Select page** to select eligible records on the current page, or select rows individually. The compact action controls appear only while records are selected and show the selected count. **Clear selection** requires no confirmation. Changing filters, page, sort, Saved View, or effective user clears selection. Switching between the Case cards and desktop table retains the same selection.

The maximum is **20 records per request**, matching the supported lists' page size. There is no “select all results” feature, cross-page selection, or unbounded browser download.

## Supported actions

| List | Actions | Eligibility |
| --- | --- | --- |
| Tasks | Mark complete, assign to an eligible Task user, set a due date | Open or In Progress, unarchived, live Account/Opportunity/Project relationships, normal Project edit rights. Sales users can select only their assigned Tasks. |
| Data Quality: unowned Accounts / unavailable-owner Accounts / ownerless open Opportunities | Assign owner / Reassign owner (Admin only) | Current issue, current search/page, unchanged versions, active/unarchived Accounts or open/unarchived Opportunities; eligible active owner under ordinary owner rules. |
| Support Cases | Assign to an eligible Support Rep (active Support or Admin), change priority | Unarchived Cases accessible to an actor with normal Case write permission. Individual Case validation still applies, including resolution-summary validation for historical resolved/closed Cases. |

Reassignment requires a named eligible user; v1 does not mass-unassign records. Due date requires a valid date; v1 does not mass-clear dates. Task lists keep their shared read visibility; visible Tasks outside the actor's bulk write scope have no selection checkbox. Support does not receive general Task mutation access. Read Only receives no selection or mutation controls. Test as user uses the effective user's permissions, scope, and write attribution.

## Confirmation, history, and failure behavior

Each action opens a keyboard-accessible modal showing the exact count, action/field, and target value. Review the target and choose **Confirm N updates**, or cancel without changing anything. Controls wrap on phones/tablets; Case cards use the same selection as the desktop table. Dialogs stay within the viewport and scroll internally.

The server accepts at most 20 unique positive IDs with displayed modification timestamps. It reloads every record under the effective actor's permissions; checkbox IDs and UI eligibility are never authorization. Changed, missing, archived, inaccessible, or invalid records reject the entire request. There are no skipped failures or partial-success mutations. A failed save keeps the dialog, selection, and target available; stale selections require refreshing the list and selecting again.

All mutations run in a serializable transaction, lock selected rows in ID order, and preserve the ordinary per-record history and notification behavior. Task and Case actions call their individual-save routines; Data Quality uses owner-only writes so unrelated fields stay untouched. Concurrent conflicts roll back and ask for a refresh/retry. Version checks and the client submission gate protect against duplicate submissions; repeated assignment/priority values do not duplicate assignment/lifecycle events. No external email is sent by these actions.

Task changes preserve `completedAt`, `updatedById`, per-Task assignment events and in-app notifications. Case-linked Tasks also record completion, reopening and changed work fields (including due date) in Support Case lifecycle history. General Task field-by-field history remains deferred; bulk actions preserve the existing individual behavior. Cases retain ordinary per-field lifecycle events, human-readable assignment labels, acting-user attribution and in-app notifications. History and notifications roll back with the records if any save fails.

After success, selection clears and list data refreshes in the same URL context. Filters, sorting, pagination and Saved Views remain intact; normal pagination clamping still applies if a filtered result shrinks. Records can move off the page or disappear from a filter after the requested field changes.

Selection, scope and version reads are batched; updates and their existing per-record history/notification logic are bounded at 20. The Data Quality extension adds nullable new-owner ID/name fields to existing Maintenance History with no backfill; Task and Case actions retain their original schema.

## Inventory and deliberately deferred actions

- Price Exceptions already have specialized Admin preview/confirm corrections, archival, and import workflows. These remain the only PE bulk controls.
- Trade Show leads already have bulk routing, assignment and specialized Contact resolution/creation. Routing uses current-page selection, displayed-version checks and explicit confirmation, with atomic rollback and Maintenance History; specialized Contact resolution retains its own rules.
- Admin Data Quality supports confirmed owner assignment for Accounts without a sales owner, Accounts assigned to unavailable owners, and Open Opportunities without an owner. All other checks retain individual record links. See [Data Quality](../../docs/data-quality-dashboard.md).
- Task bulk archive/restore is deferred: individual archive attribution is inconsistent with the richer archive model, and cleanup policy needs reconciliation before expanding it.
- Case bulk status, resolve, close, archive and restore are deferred. Status changes can reopen work or require resolution details that deserve individual review.
- Activities have individual and related-record views with archive/restore, rather than an operational bulk queue. No clear cleanup workflow justifies adding broad mutation or a new list solely for bulk controls.
- Contacts/Accounts have individual edit/archive workflows and duplicate review. Account owner correction is limited to the unowned and unavailable-owner Data Quality checks; relationship rewriting, merges, bulk archival and deletion remain deferred. Contacts have no equivalent general owner-assignment workflow.
- Opportunities and Projects have ownership restrictions, relationship dependencies, and sales-process/status rules. Stage/status changes remain individual; owner corrections are limited to the supported Admin Data Quality issue.
- Bulk deletion is intentionally excluded everywhere.

## Validation

Unit tests cover request bounds, malformed/duplicate IDs, confirmation, and authorization before database access. Playwright includes direct database-backed domain tests for all five actions, individual history/notifications, stale/deleted/archived/inaccessible selections, invalid mixed states and target values, effective-user attribution, and transaction rollback after a preceding write. Browser tests cover selection, current-page limits, conditional controls, all five actions, cancellation, preserved query context, role filtering, and Test as user. Responsive projects check 390×844, 768×1024, 1024×768 and 1440×900, including selection, modal bounds, keyboard focus, success, and overflow.

Run `ENABLE_DEV_IMPERSONATION=true npm run test:e2e -- e2e/bulk-actions.spec.ts e2e/bulk-responsive.spec.ts` from `app/`. Tests use the isolated E2E database, never the operational database.

Validated on 2026-10-15 with Node 22.23.3: lint, typecheck, all 161 unit test files, seven bulk server/browser tests, eight responsive tests, and 13 existing Support/dashboard/Saved View regressions passed. `npm run build -- --webpack` passed, including production compilation, TypeScript, static generation and traces. The default Turbopack production build was attempted but this execution environment denied its compilation-worker port; no build configuration was changed.

## Changed files

- List UI and actions: `app/app/tasks/page.tsx`, `app/app/tasks/bulk-actions.ts`, `app/app/support/cases/page.tsx`, `app/app/support/cases/bulk-actions.ts`, `app/components/bulk-selection.tsx`, `app/app/globals.css`.
- Shared mutation and validation: `app/lib/bulk-action-contract.ts`, `app/lib/bulk-actions.ts`, `app/lib/work.ts`, `app/lib/support-cases.ts`, `app/lib/support-work.ts`.
- Tests and configuration: `app/tests/bulk-actions.test.mjs`, `app/tests/engagement.test.mjs` (supply the already-required responsible user in an Activity fixture), `app/e2e/bulk-actions.spec.ts`, `app/e2e/bulk-responsive.spec.ts`, `app/playwright.config.ts`.
- Documentation: `app/docs/bulk-actions.md`, `app/docs/ui-conventions.md`, `CHANGELOG.md`.

The original Task/Case release included no migration. The Data Quality extension uses the additive owner-history migration; no dependency or local environment configuration changes are needed.

Unavailable-owner Accounts use the ordinary Account ownership eligibility helper (active, unarchived, Account write permission) for both the issue and replacement owner. Confirmation names the unavailable-owner condition and destination. Submission rechecks issue/page/search membership, unchanged versions and current Admin rights; any failure rolls back the group. Maintenance History records “Reassigned N Accounts to Name” with new-owner ID/name snapshot. This extension needs no additional migration and does not mutate Contact rows.
