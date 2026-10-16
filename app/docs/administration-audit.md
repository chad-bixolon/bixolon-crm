# Administration audit and operations v1

Administration remains a set of focused tools; no new primary sidebar module is added. All new reports require `users.manage` for the **effective** active, unarchived user. Only Admin has that permission. Test as user therefore removes access when testing another role. Queries never use the real Admin identity as a reporting bypass. The existing personal Calendar settings page intentionally uses the authenticated Google identity and explains this distinction.

## Ownership & Reassignment

`/administration/ownership` counts and pages current operational Accounts, Contacts, open Opportunities, unfinished Tasks, active Projects, and unresolved Support Cases with an inactive, archived, or role-ineligible owner/assignee. Uses the existing eligibility and operational-parent predicates. Closed/archived work and work under inactive parents are excluded. Filters select entity and current user; each entity's count uses the same predicate as its drill-down.

Ownership is optional in the current Account, Opportunity, Project and Task forms; a missing owner is not a new validation error. Contacts inherit Account ownership and have no independent owner. Data Quality retains its existing unowned Account/Opportunity review signals. No Contact ownership field or ownership requirement is introduced.

Tasks and Support Cases offer confirmed reassignment on the current page through Bulk Actions (maximum 20). Existing services check versions, permissions, eligible assignees, ordinary form rules, parent relationships and business validation. One failure rolls back the full selection, per-record events, notifications and maintenance log together. Legacy records requiring corrections must use their individual forms. Accounts, Opportunities and Projects link to those forms; Contacts link to their Account's edit form. There is no new generic owner update endpoint.

## System Health

`/administration/system-health` reuses database/migration, Spaces HeadBucket and recorded scheduler checks. Adds paginated Calendar connections (25), successful/attempt/failed-sync timestamps when recorded, inactive-user indication, disconnected-user count and up to 10 currently unresolved connection errors. Errors use fixed business labels and never display provider text. A failed-sync timestamp is shown only if a completed attempt postdates the last successful sync; authorization failures without a trustworthy timestamp show Not recorded. Successful retries clear connection errors, so this is not a durable failed-attempt log.

Support Gmail shows disabled, fixture, connected, disconnected or unavailable based on existing configuration/status checks and persisted last successful fetch. A stored connection does not prove live authorization. Gmail only keeps transient fetch errors; durable failure reporting is deferred. Links go to Support Inbox and My Integrations; no setup controls are duplicated. Calendar credentials remain user-managed. Uninstrumented jobs are not represented as healthy. Applied/failed migration counts do not prove every expected migration is installed.

Raw job result/error summaries are omitted. No credentials, tokens, keys, provider responses, connection strings or stack traces are rendered. All checks are read-only and bounded.

## Audit History

`/administration/audit-history` normalizes existing records at query/display time, with date range (inclusive UTC calendar days), actor, entity and action filters. Displays Eastern timestamps, actor when known, record reference/link, change and recorded previous/new values. Database pagination returns at most 25 rows, deterministically ordered, in a repeatable-read transaction with a consistent count. No browser-side history loading or per-row lookup is used.

| Source | Included evidence | Limits |
| --- | --- | --- |
| OpportunityHistoryEvent and OpportunityHistoryArchive | Stage, value and currency, expected close date, owner, forecast category, probability, recorded relationships, archive/restore, creation | Baseline events do not imply changes before capture; archived data retains original context. Duplicate live/archive source IDs are not double counted. |
| SupportCaseLifecycleEvent | Status, priority, assigned rep, creation and recorded archive state | Only curated fields; no descriptions or arbitrary lifecycle payloads. |
| TaskAssignmentEvent | Previous/new assigned user and actor | No historical completion or due-date events exist. Names resolve against current users; deleted/missing references use an explicit fallback. |
| PriceExceptionLifecycleEvent | Old/new lifecycle status | Existing PE tooling remains the full source. |
| PriceExceptionFollowUpEvent | Changed follow-up status, owner and next follow-up date | Only curated JSON keys; notes/source metadata are excluded. General PE admin/source revisions remain in PE Cleanup. |
| Account, Contact, Activity archive metadata | Current archive timestamp and archived-by actor, when preserved | Labeled **Current archive metadata**. Not an append-only lifecycle source; disappears after restore. Previous/new values are not inferred. |

Missing values display **Not recorded / empty**; null historical values cannot distinguish an explicitly cleared value from a value the source never recorded. Current editor or completion timestamps are not presented as past change events. Names from event snapshots remain snapshots; sources without name snapshots resolve current record/user labels. No existing historical rows are rewritten.

## Maintenance History

`/administration/maintenance-history` provides the same bounded date/actor/entity/action filters over `AdminMaintenanceEvent`. Entries contain only time, actor ID, curated entity/action, affected count and up to 20 record IDs. Database triggers reject updates, deletes and truncation. Actor IDs and record IDs deliberately have no live foreign keys, retaining references after account cleanup. Missing actors remain explicit; there is no invented actor name. Page views/filter changes are not logged.

Supported writes are atomic with the operation:

- Validated Task reassignment/completion/due-date bulk actions and Support reassignment/priority bulk actions, including authorized non-Admin operations.
- Account, Contact, Activity and Task archive/restore; Contact activate/deactivate.
- Existing confirmed PE Cleanup archive/expire/assignment/link actions, preserving their validation and existing per-record lifecycle events.
- Confirmed Account/Contact CRM imports, with affected count and no uploaded content.
- Existing Opportunity/Forecast history batch archive and restore, with affected count.

Individual record links open the source; the ledger is read-only. Existing record-level authorization and validation still govern every maintenance action. There is no delete tool or mass relationship rewrite. New reassignment controls use the existing explicit confirmation dialog. Individual Account/Contact/Activity/Task state changes and history batch archive/restore also request confirmation; their server validation remains unchanged.

Migration `20261015210000_admin_maintenance_history` creates only this small ledger and its time/actor indexes. Deploy it using the normal reviewed migration procedure before enabling the new reports/writers. No historical data is backfilled or rewritten. Tests apply it only to the isolated E2E database; this feature does not deploy production changes.

## Deferred

Full Account/Contact/Activity ownership or relationship timelines, restore-cycle reconstruction, Task completion/due-date events, general PE admin assignment/source-revision normalization, other import families, integration connect/disconnect and retry/recovery maintenance entries, durable integration attempt history, uninstrumented schedulers, and full expected-schema readiness checks. Existing module-specific revision/import tools remain authoritative for their preserved evidence. A generic all-model event log would need a separate design for capture, actor attribution, redaction, retention and transaction boundaries; v1 does not introduce one.

## Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: all 164 test files passed, including ownership predicates, denial, filters/pagination, safe health output and maintenance writes.
- Relevant Playwright: 19 checks passed across Administration, existing Bulk Actions and the new audit/maintenance coverage. Includes 1440px desktop, 768px tablet and 390px phone layouts, Test as user denial, old/new/missing values, archived history, confirmed reassignment, import/PE cleanup logging, append-only protection, and Account/Task/Activity archive/restore.
- Production build: `npm run build -- --webpack` passed. Default Turbopack build was attempted and retried with approved execution; its CSS worker could not bind a local port in this environment. No build-script/configuration change was made.
- `git diff --check`: passed. Migration deployed only to the dedicated E2E database; production was not migrated or deployed.
