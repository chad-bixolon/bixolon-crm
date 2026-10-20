# Data Quality / Cleanup

The Administration page links to a dashboard for Admin users. Each card counts current records matching one review rule. Selecting a card opens a server-side paged list, with a search field and links to existing CRM records. A record can appear in more than one group. Admins can assign or reassign owners in the three supported checks described below. PE Cleanup remains the place to review Price Exceptions.

## Implemented checks

| Group | Rule |
| --- | --- |
| Accounts without a sales owner | Active, unarchived Account with no owner. |
| Accounts assigned to unavailable owners | Active, unarchived Account with an owner excluded by `eligibleUserWhere('accounts.write')`: inactive, archived, or without Account write permission. Unowned Accounts remain in their separate check. |
| Contacts without an Account | Active, unarchived Contact with no Account. |
| Contacts linked to an inactive Account | Active, unarchived Contact whose Account is inactive or archived. |
| Open Opportunities without an owner | Unarchived Opportunity in an open stage with no owner or an inactive/archived owner. |
| Open Opportunities without an Account | Unarchived Opportunity in an open stage without an Opportunity Account participant. A legacy direct Account link is not authoritative. |
| Open Opportunities linked to an inactive Account | Unarchived Opportunity in an open stage with an inactive or archived participating Account. |
| Open Opportunities without an expected close date | Unarchived Opportunity in an open stage with no expected close date. |
| Projects without a primary Account | Unarchived Project in Planning, Active, or On Hold status with no primary Account. |
| Projects linked to an inactive Account | Such a Project whose primary Account is inactive or archived. |
| Open Tasks linked to archived records | Unarchived Open or In Progress Task linked to an archived Account, Opportunity, Project, or Contact. |
| Activities linked to archived records | Unarchived Activity linked to an archived Account, Opportunity, or Project. |
| Possible duplicate Accounts | Active, unarchived Accounts with identical names after trimming, collapsing whitespace, and ignoring case. |
| Possible duplicate Contacts | Active, unarchived Contacts with identical nonblank email addresses after trimming and ignoring case. |

Counts use database aggregates and duplicate groups use SQL window aggregation. Owner-assignment lists fetch 20 rows per page; other detail lists fetch at most 25 rows per page. Search is applied by the database. Possible duplicates are review candidates, not errors or merge instructions.

## Deferred checks

- Stage-specific Opportunity fields: stages define open/closed and probability, but no per-stage required-field policy exists.
- Standalone Task or Activity relationship context: existing workflows permit records without a CRM parent, and some tasks belong to Support Cases or Trade Show Leads.
- Broken references: declared foreign keys prevent normal writes from creating references to missing records. An integrity audit should handle bypassed constraints separately.
- Inactive, rather than archived, Task and Activity relationships: inactivity may be intentional historical context; the dashboard flags archived links only.
- Broad fuzzy duplicates: shared names and domains can describe distinct customers or people. This version uses exact normalized signals only.

## Bulk owner assignment v1

**Accounts without a sales owner**, **Accounts assigned to unavailable owners**, and **Open Opportunities without an owner** support bulk correction. Select records → choose an eligible owner → Assign owner (or Reassign owner) → confirm. Reassignment confirmation names the count, unavailable-owner condition, and replacement owner. Select page selects at most 20 visible records. Search, issue and page changes clear selection; there is no selection across pages. Open record remains available.

The server rechecks the effective Admin against the current User row, owner eligibility under the ordinary Account/Opportunity assignment rules, record existence and versions, active/open issue criteria, search and current-page membership. User locks hold permission/eligibility through commit; selected records use ordered locks in a serializable transaction. One failure rolls back every record, history entry and notification. Refresh after stale selection errors. Success refreshes list and summary counts.

Account updates preserve updated-by attribution; Contacts continue to follow their Account. Opportunity updates preserve updated-by attribution, OWNER history (old/new owner names), assignment notifications and notification reconciliation. Individual edit behavior and Sales permissions are unchanged. Admin impersonation uses the effective user's permissions.

One existing Maintenance History event records **Assign owner** for the original checks or **Reassign** for unavailable-owner Accounts, record type, count, affected IDs, effective Admin, timestamp, new owner ID and a display-name snapshot. The nullable `newOwnerId` / `newOwnerName` extension has no backfill and retains append-only protections. The User FK restricts deletion/update of the referenced ID. Existing events retain NULL destination fields. History uses wording such as “Assigned 20 Accounts to Jane Smith” and includes affected-record links.

Unavailable-owner reassignment reuses the same transaction and `updatedAt` token, advances the Account version, and leaves Contact rows untouched. If a current owner regains eligibility, the Account no longer matches even when its own version is unchanged. Replacement owners must be active, unarchived, and permitted to write Accounts; currently Admin, Sales Manager, or Sales. No schema migration is needed for reassignment.

All other groups remain individual review. Deferred reassignment candidates include unavailable-owner Opportunities and Projects as dedicated bulk groups, and general Contact owner changes. The existing Opportunity owner check retains its original criteria and behavior. No general mass reassignment, cross-page selection, relationship rewriting, or bulk deletion is enabled.

## Bulk v1 implementation files

Paths are relative to the repository root.

| Area | Files |
| --- | --- |
| Data Quality UI and action | `app/app/administration/data-quality/page.tsx`, `app/app/administration/data-quality/bulk-actions.ts`, `app/components/bulk-selection.tsx` |
| Validation and ownership writes | `app/lib/data-quality.ts`, `app/lib/data-quality-bulk.ts`, `app/lib/bulk-actions.ts`, `app/lib/opportunities.ts` |
| Maintenance History | `app/lib/admin-maintenance.ts`, `app/lib/admin-audit.ts`, `app/components/admin-audit-page.tsx` |
| Additive schema | `app/prisma/schema.prisma`, `app/prisma/migrations/20261019120000_data_quality_owner_history/migration.sql` |
| Help and documentation | `app/lib/help/topics.ts`, `app/docs/bulk-actions.md`, `docs/data-quality-dashboard.md` |
| Unit and migration tests | `app/tests/data-quality.test.mjs`, `app/tests/data-quality-bulk.test.mjs`, `app/tests/admin-audit.test.mjs`, `app/scripts/test-migrations.py` |
| Browser/server/responsive tests | `app/e2e/data-quality-bulk.spec.ts`, `app/e2e/bulk-responsive.spec.ts`, `app/e2e/bulk-actions.spec.ts`, `app/e2e/helpers.ts` |

## Bulk v1 validation — 2026-10-19

Validated with Node 22.23.3. No production data was changed; migrations and write tests ran only in disposable migration databases or `saleshub_e2e_data_quality_bulk` on the dedicated local E2E PostgreSQL service.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm test` | 1,356 passed, one existing default-skipped read-only SQL fixture test. Includes Data Quality, shared bulk contract, authorization and Maintenance History tests. |
| `python3 app/scripts/test-migrations.py` | Passed: 80-migration fresh replay, populated upgrade, all-table preservation, nullable owner fields with no backfill, owner FK, append-only history, name snapshot, schema parity, repeat deployment and invalid-fixture rollback checks. |
| Data Quality / bulk-action / Maintenance History Playwright regressions | 40 passed with development impersonation enabled. Includes all supported writes, stale/inactive/deleted/closed/reassigned states, current-page/search enforcement, destination eligibility, live Admin checks, rollback after writes, per-record history/notifications, refreshed summary counts and business-friendly maintenance entries. |
| Last-page and touch-enabled responsive Playwright checks | 17 passed, including existing Task/Case bulk regressions. Together with the focused suite, desktop, phone, 768px, 820px and 1024px checks pass: 44px tablet controls, wrapping, modal focus/bounds, scrolling and success refresh. |
| `npm run build -- --webpack` | Passed: production compilation, TypeScript, page generation and build traces. Default Turbopack was attempted but its CSS worker could not bind a compilation port in this execution environment. Build configuration is unchanged. |
| `git diff --check` | Passed. |

Run browser checks from `app/` with `E2E_DATABASE_NAME=saleshub_e2e_data_quality_bulk ENABLE_DEV_IMPERSONATION=true npm run test:e2e -- data-quality.spec.ts data-quality-bulk.spec.ts bulk-actions.spec.ts admin-audit.spec.ts --project=desktop-chromium`. The separate responsive run selects `bulk-responsive.spec.ts` plus the last-page test across the desktop, phone, tablet portrait, tablet landscape and responsive desktop projects.

The migration is prepared and tested, not deployed. No commit, push, deployment, historical-event backfill, unrelated schema change or production mutation is included.


## Unavailable-owner Account reassignment v1 — 2026-10-19

The existing `account-owner-inactive` URL now supports the same bounded bulk workflow as unowned Accounts. The business label is **Accounts assigned to unavailable owners**, with helper “These Accounts are still assigned to users who can no longer manage them” and empty state “No Accounts need owner reassignment for these filters.” Selection, search, paging, counts, record links, cancellation, and last-page clamping remain available. The existing unowned Account and open Opportunity predicates are unchanged.

Submission rechecks the effective Admin's current User row and destination eligibility under shared User locks, locks selected Accounts in ID order, rechecks existence, active/unarchived status, unavailable-owner condition, displayed `updatedAt`, and current issue/search/page membership. The existing serializable transaction saves all Accounts and one Maintenance History event together; validation errors, serialization conflicts, or failed history writes roll everything back. Account versions advance using `nextUpdatedAt`, protecting individual forms opened before reassignment. Contact versions/records are untouched and ownership continues to come from the Account.

History stores `Reassign`, actor, timestamp, count, all selected Account IDs (at most 20), new-owner ID, and name snapshot; the display uses “Reassigned N Accounts to Name.” Existing unowned assignment retains `Assign owner` / “Assigned.” No migration, push, deployment, DigitalOcean changes, or production-data mutation is part of this extension.

Files changed in this extension (paths relative to repository root):

| Area | Files |
| --- | --- |
| Existing workflow/UI | `app/lib/data-quality.ts`, `app/lib/data-quality-bulk.ts`, `app/app/administration/data-quality/page.tsx`, `app/components/bulk-selection.tsx` |
| History display | `app/lib/admin-audit.ts` |
| Help | `app/lib/help/topics.ts` |
| Focused tests | `app/tests/data-quality.test.mjs`, `app/tests/data-quality-bulk.test.mjs`, `app/e2e/data-quality-bulk.spec.ts`, `app/e2e/bulk-responsive.spec.ts` |
| Documentation | `app/docs/bulk-actions.md`, `docs/data-quality-dashboard.md`, `CHANGELOG.md` |

Validation uses Node 22.23.3 and only the disposable `saleshub_e2e_unavailable_owner` database on the existing local E2E service. During implementation validation, `release:check` was deferred until a clean commit; its separate release report records the validation of that commit. General Contact/Project reassignment and a separate unavailable-owner Opportunity bulk group remain deferred; the existing Opportunity cleanup is preserved.


| Reassignment validation | Result |
| --- | --- |
| Lint / typecheck | Passed. |
| Full unit suite | 1,390 passed; one existing skipped SQL fixture test. Includes Data Quality, bulk contract, eligibility, permissions/impersonation, stale-edit and Maintenance History. |
| Data Quality bulk server/browser checks | All 38 checks passed across the corrected focused run and affected-case rerun: issue criteria, actual writes, counts, versions, permissions, restored owners, target deactivation, rollback after writes, owner snapshots, search, paging and layouts. |
| Existing regression suites | 52 passed: Data Quality dashboard (3), bulk actions (7), Maintenance/Audit History (9), Help (16), stale edits/concurrency (17). |
| Final responsive/affected-case run | 24 passed: 20 touch-enabled workflow tests across phone, portrait/landscape tablets and desktop, plus the issue-criteria case and three 1024px checks. Includes real reassignment and visible Maintenance History at every responsive size. Screenshots reviewed at 390, 768, 1024 and 1440 pixels. |
| Production build | `npm run build -- --webpack` passed: compilation, TypeScript, page generation and traces. |
| `git diff --check` | Passed. |

Initial archived-user fixtures were corrected to satisfy the existing archive/inactive constraints. One browser check affected by concurrent Prisma regeneration was rerun after separating generation/build and browser validation. No application workaround or configuration change was introduced. Sandbox subprocess restrictions required running the unit suite, production compiler and local browser/database checks with execution approval. Task-owned logs, screenshots/reports and the disposable database were cleaned afterward; generated framework edits were restored.
