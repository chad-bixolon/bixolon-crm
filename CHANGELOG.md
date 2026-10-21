# SalesHub Changelog

This changelog separates current working-tree changes from committed, user-facing
SalesHub work. Versions below are
retrospective release groupings, not historical Git tags or verified deployment
boundaries. Dates are the dates of the last commits in each group.

## Working tree — Support Inbox Triage & Documentation Quick Wins v1

- Added visible configured Inbox scope, compact All/Unlinked/Needs Review views and counts over the current batch, and an older-mail Gmail link. View switching stays local; ignored messages remain separate. Updated concise Inbox Help and focused tests. No migration or provider strategy change.
- Reconciled missing committed work below and corrected stale Saved Views, bulk-action and Administration documentation. This working-tree change has not been committed or deployed; earlier dated validation records remain historical evidence.

## Working tree — Shared Editor Stale-Edit Protection v1

- Extended the existing shared edit checks to Contacts, Projects, ordinary Activities and editable Notes. Forms retain entered values on conflicts and offer the existing review/reload controls; missing or invalid form tokens require reload, including for Admins and impersonated users.
- Contact primary transfers and Project participant changes save transactionally with the parent comparison. Project Opportunity link/unlink transactions now advance the Project token too. Note edits use the Note token; creation and Calendar logging/deduplication stay unchanged. Existing role, ownership and history policies remain in place. No migration.
- Other shared editors still using last-write-wins include Project/Opportunity Update entries, Marketing Campaigns and Audience definitions, Demo Request notes/relationships, Products/SKU metadata, Trade Show setup, and saved Report definitions. These remain outside this build; no ownership policy decision is required for the included editors.

## Unreleased

- Added Opportunity outcomes with Actual Close Date, configured Won/Lost reasons, optional notes, validated closure/reopen transitions and immutable outcome history. Legacy unknown dates remain explicit; Expected Close Date and historical snapshots retain their meaning.
- Added Pipeline Movement Weekly Comparison and History & Outcomes, with weekly snapshot charts, reference-cohort outcomes, expected-versus-actual close timing, slippage detail, historical reason analysis and quarter comparisons. Missing captures and unsupported historical dimensions remain explicit; currencies remain separate.
- Added company currency configuration, Admin currency management/default protection, simplified single-currency entry and reporting, and retained access to inactive historical currencies. No FX conversion or consolidated currency totals.
- Added confirmed Admin Data Quality owner assignment for unowned Accounts and ownerless open Opportunities, with bounded current-page selection, atomic version checks and Maintenance History. Unavailable-owner Account reassignment is listed separately below.
- Added stale-edit protection for shared Account, Opportunity, Task and Support Case forms, preserving entered values and offering a fresh-record recovery path. Extended displayed-version checks and confirmed mutation safety to Trade Show lead edits/routing and Price Exception maintenance.
- Completed Support Case Notes and assigned/unassigned-created Case Task editing, completion and reopening with Case lifecycle evidence and existing Support authorization boundaries.
- Improved the Trade Show Follow-Up Queue with linked Task status/due date/assignee, rolling due periods, personal Saved Views, event summaries and confirmed version-checked bulk routing. Lead metadata and Task completion remain independent.
- Added Support History Retrieval: paginated stored Case history, source filters, bounded Note previews and full read-only Note pages. Existing Case permissions apply; history retrieval makes no Gmail requests. No migration.

- Recent Items v1 (committed 2026-10-13): added a compact authenticated header history popover with current business labels, entity types, viewed timestamps, direct links and empty/loading/failure states. Keyboard focus, outside click and Escape follow shell conventions across phone, tablet and desktop.
- Added per-user PostgreSQL history for Accounts, Contacts, Opportunities, Projects, Support Cases, Price Exceptions, Tasks and Activities. Actual record access updates one entry, persists across sessions/devices, and retains at most 50 records under concurrent visits. Reads recheck permissions and operational visibility and batch only the needed display fields.
- Added a read-only Activity detail destination, documented deferred dashboard duplication and stale-reference eviction, and added unit/browser/database regression coverage. Forward-only migration: `20261013120000_recent_items`.

- Added Opportunity list outcome filters for Open/Won/Lost, inclusive Actual Close Date ranges, and configured Outcome Reasons including inactive history. Personal Saved Views retain the new criteria; expected-date filters remain separate. Closed rows show recorded actual dates/reason labels, with unknown legacy dates explicit. No migration.

- Extended Admin Data Quality bulk owner correction to Accounts assigned to unavailable users, using current Account eligibility rules, current-page selection (maximum 20), explicit reassignment confirmation, atomic version-checked saves, and readable Maintenance History with destination ID/name. Added concise Data Quality/Ownership Help and regression coverage; Contacts retain inherited ownership. No schema migration.

- Added Durable Integration Attempt History & Failure Status v1 under Admin Maintenance History and System Health. The shared job ledger records explicit Support Gmail actions and per-connection Calendar syncs, reuses weekly snapshot attempts, and shows safe failures and conservative matching recoveries with filters, pagination and record links. Added bounded Calendar requests/syncs, privacy and retention guidance, and forward-only migration `20261018010000_integration_attempt_history`; no provider polling or automatic cleanup is introduced.

- Added rolling Task due-date periods (Overdue, Due today, Next 7 days and This week) alongside fixed custom ranges. Personal Saved Views retain relative meaning and recalculate with Eastern business dates; existing absolute views and Task defaults remain compatible. No database migration.

- Added Weekly Opportunity + Forecast Snapshot Automation v1 through the shared capture services, protected internal trigger, safe weekly retries/manual reuse, explicit service attribution, durable execution history and compact Admin status. Default cadence: Monday 05:00 America/New_York; forecast quarter comes from the exact source timestamp. Forward-only migration: `20261016230000_weekly_snapshot_automation`. DigitalOcean setup and quarter-end limitations are documented in `docs/weekly-snapshot-automation.md`; no schedule or deployment is installed by this change.

- Correctness Cleanup v1: scoped standalone Pipeline totals to the effective salesperson, aligned Price Exception selection/save/restore with New York expiration dates, corrected related Task/Note navigation, and distinguished Forecast Movement captures from Forecast Snapshot History. Sales record viewing is cross-owner; standalone Pipeline defaults to the effective Sales rep and allows an explicit eligible-rep filter. Owner-specific actions and financial/personal scopes are unchanged. No database changes.

- Added Help & Onboarding v1 at `/help`, with practical, searchable guidance grouped by role and a Help & Guide entry in the account menu. Topics and editing instructions follow existing permissions, including Read Only access and the full Admin guide.
- Added contextual Help links for Forecast Category, forecasting and snapshots, Support Inbox, Log Email Response, Price Exceptions, Audit History, Maintenance History, and Bulk Actions. Simplified nearby helper text and documented topic maintenance in `app/docs/help-maintenance.md`. No database changes.

- Added Admin-only Ownership & Reassignment, Audit History and Maintenance History areas, reusing record validation, bulk confirmation and existing per-module histories with server pagination. Added the small append-only maintenance ledger migration `20261015210000_admin_maintenance_history`.
- Extended System Health with safe Calendar connection/sync and Support Gmail fetch status; removed free-form job/provider errors from the health display. Documented audit coverage, missing historical evidence and deferred integrations in `app/docs/administration-audit.md`.

- Added immutable source-linked Forecast Snapshot runs and owner/currency/category rollups with forward-only migration, duplicate protection, atomic completeness checks and exact source validation. Migration: `20261015160000_forecast_snapshot_runs`.
- Added explicit forecast-ready scope to the shared Opportunity Snapshot capture service, preserving open/Closed Won status and point-in-time owner eligibility without changing default open-only or live forecast behavior.
- Added Admin preview/confirmation and Admin/Sales Manager Forecast Snapshot History with quarterly comparisons, salesperson history, currency separation, safe percentage math and drill-through to the shared Opportunity Snapshot comparison.
- Documented inclusive Pipeline semantics, Expected Close Date period rules, Closed Won limitations, storage estimates, future accuracy reporting and shared-service weekly automation. No schedule, FX, backfill or production migration added.

- Added Opportunity Snapshots v1: immutable weekly run/row models, atomic Admin preview/confirmation with stale-preview and duplicate-week protection, and preserved Opportunity, Account, owner, stage, value, probability and forecast context. Forward-only migration: `20261015120000_opportunity_snapshots`.
- Added Admin/Sales Manager Opportunity Snapshot History comparisons with historical filters, currency-separated pipeline totals, bounded server pagination, and compact owner-scoped detail history. Open operational scope, neutral entry/exit interpretation, storage estimate, and deferred automation are documented in `docs/opportunity-snapshots.md`. No scheduler or live Opportunity save changes.

- Added safe current-page bulk actions for Tasks (complete, assign, set due date) and Support Cases (assign, change priority), with a 20-record limit, selection-only controls, responsive confirmation dialogs, and preserved filters, pagination and Saved Views.
- Bulk mutations recheck effective-user permissions, scope, displayed versions and individual business rules inside atomic transactions, preserving per-record history, notifications and attribution. Added direct authorization/rollback and desktop/tablet/phone browser coverage. No migrations; deletion, archive, Case status and ambiguous sales/relationship changes are intentionally deferred. Existing Price Exception bulk administration is unchanged.

- Added Role-Based Dashboard Polish v1 using shared widgets and centralized defaults for all six roles: personal Sales work, team manager summaries, Support intake/tasks/activity, Admin Data Quality and recorded job health, existing Marketing campaign/attribution content, and a concise Read Only overview.
- Dashboard and customization now honor cross-section ordering; Tasks include overdue and next-seven-day follow-ups. Preserved permissions, Quick Actions, header Recent Items, real-identity My Day, and existing saved layout overrides. Added role, empty-state, impersonation and responsive coverage; no schema changes.

- Added an Admin-only, read-only Data Quality / Cleanup dashboard with server-side issue counts, paged review lists, and links to CRM records and PE Cleanup.

- Added permission-aware contextual Quick Actions on Account, Contact, Opportunity, and Project details, plus a compact global Quick Create menu using existing forms.

- Added semantic Opportunity Close Period filters with rolling quarter choices and Saved View support.

- Added personal saved views for commonly used list filters.

- Added a permission-aware global search palette for core CRM records, with keyboard and mobile access.

- Added Admin system health checks and recorded notification/Calendar job runs with conservative stale and failed status.

- Added personal in-app notification category preferences and time-zone-aware snooze; Critical alerts remain mandatory.

- Improved SalesHub responsiveness and usability across phone and tablet layouts.

- Added file attachments to Support Cases using secure object storage; removal permanently deletes the binary while retaining audit metadata and timeline history.

- Split Support Case history into a concise operational timeline and a separate field-level audit view, both collapsed by default.

- Added a local Chromium Playwright E2E suite for failed-save forms, pickers, Opportunity intake, and Price Exception correction.

- Support Cases can now be created directly as Resolved or Closed with a required Resolution Summary in the initial save.

- Standardized form validation behavior so failed saves preserve entered values and entity selections across SalesHub.

- Support Cases now retain the reported Customer / End User without requiring a CRM Account. Optional Account linking, complete failed-save form state, and the shared scrollable Product / SKU popover improve intake.

- Added Support dashboards, reporting, Excel export, and in-app case notifications.

- Added Purchased From capture on Support Cases with optional CRM Account normalization for channel reporting.

- Integrated Support Cases with Accounts, Contacts, Activities, Tasks, Notes, and a unified case timeline.

- Removed remaining user-facing internal database IDs in favor of business names and identifiers.

- Added operational Support Case management with list, detail, create/edit, filtering, history, and category administration; creation fields appear together in Case History while audit events remain separate.

- Added Support Case foundation with BXS case numbers, lifecycle auditing, configurable categories, and Support permissions.

- Added My Day dashboard and daily activity view with Calendar meeting time, Activities, and Tasks.

- Added Calendar Matches review with Contact/Account matching and prefilled Activity logging.

- Completed an application-wide UI consistency pass across forms, filters, buttons, dropdowns, and administration pages; refined Notification Center filtering and presentation, and changed coverage KPIs to percentage display.

- Added Google Calendar event synchronization foundation with bounded initial sync and incremental updates, plus personal time-zone settings for Calendar timestamp display.

- Added the Google Calendar connection foundation with read-only OAuth consent and secure credential storage.

- Expanded Notification Center with Task and Opportunity attention alerts and category filtering.

- Added SalesHub Notification Center with in-app Price Exception expiration and follow-up alerts.

- Added manual lifecycle expiration for eligible Price Exceptions, including bulk cleanup and per-PE audit history; refined PE Cleanup issue shortcuts, filters, selection feedback, and bulk correction controls.

- Added a Sales expiration follow-up workflow for Price Exceptions with ownership, dated actions, audit history, report filters, dashboard counts, and Excel fields; stored PE status remains independent.

- Added Sales Rep filtering to Account and Contact lists for faster CRM follow-up.

- Added Price Exception expiration reporting, dashboard follow-up alerts, and Excel export for expired and upcoming PEs.

- Improved Sales Plan exports with direct access from Sales Plan, compact report filters, consistent primary report actions, and more presentation-ready management and SKU workbooks.
- Improved Price Exception import review by treating N/A party roles as intentionally blank, clarifying revision choices, and formatting source timestamps.
- Added a Lead Sources report that counts unique prospects without double-counting resolved leads and Contacts.
- Improved the Marketing dashboard and added Marketing Attribution reporting for Campaign Influence activity.

### Added

- Added compact Dashboard widgets for Forecast Movement, Sales Plan status, and Marketing activity.
- Sales Plan SKU Rollup report for exact part number demand, Account and rep contributions, unresolved lines, quarterly allocation, and a three-sheet Excel export.
- Sales Plan management Excel export with current targets, approved plan allocations, live Opportunity forecast, SKU detail, and conservative planned versus unplanned pipeline comparison.
- Marketing attribution foundation with configurable Lead Sources, Campaigns, dated Campaign Influences, Trade Show import automation, Contact and Opportunity context, Marketing management, and correction history.
- Opportunity change history, weekly forecast snapshots, a Forecast Movement report, and an Admin retention/archive workflow.
- Local development user impersonation for Admin led role and ownership UAT; disabled in production.
- Sales Plan management with review-first workbook imports, official annual revisions, rep quarterly allocation, target comparison, and a management report.
- Explicit management preview and sync from an active annual Sales Plan to quarterly Sales Targets, with exact cent allocation, conflict checks, and audit history.
- Forecast Attention on the Dashboard and Quarterly Forecast report, highlighting missing targets and Opportunities needing follow-up.
- Opportunity creation from an Account, with the Account preselected.

### Improved

- Improved the Campaigns list with compact filters and richer campaign summaries.
- Expanded Marketing Manager visibility with read-only access to Accounts, Contacts, Opportunities, and Projects for campaign and attribution context.

- Improved Campaigns with a read-only detail view, clearer influence metrics, and dedicated editing.

- Reorganized the main navigation into functional CRM, Sales, Programs, Marketing, Catalog & Pricing, Reports, and Administration groups.
- Expanded Opportunity History to capture participating Account, Contact, and Project relationship changes.
- Reorganized Administration into compact functional groups for faster navigation.
- Aligned Forecast Snapshot capture controls with their inputs on the history administration page.
- Refined Opportunity and Forecast History administration into compact snapshot, archive, and restore status sections with clearer dates, counts, actions, and empty states.
- Opportunity History starts collapsed and calls out close-date changes that move an Opportunity into another quarter.
- Opportunity History now uses clearer labels and dates and appears after the Opportunity's working sections.
- Improved Contact address selection with clearer Account-address and custom-address choices.
- Sales Plan pages and management reports paginate plan lines while keeping totals across the full selection.
- Sales Plan allocation is easier to review and edit, with an even-split option, clearer status, and consistent currency, unit, and percentage formatting.
- New CRM records default eligible owner and assignee fields to the current user or the relevant source record.
- Creating a Contact from an Account returns to that Account's Contacts tab; Contacts can use the Account address or keep a different address.
- Project update actions are easier to find and use.
- Sales Rep filters across reports hide redundant self/all choices for Sales users and offer clearer multi-rep choices for management.
- Sales users can view Trade Show event details and resources without gaining Trade Show management access.

### Fixed

- Supported cancelled Demo Requests while preserving deployed inventory and return tracking.
- Fixed Pipeline navigation so users without Pipeline access no longer see a dead-end link.
- Fixed Product action visibility so Product readers no longer see management actions they cannot perform.
- Sales Plan team targets and forecasts count reps with an active plan for the selected year and currency.

Items under Unreleased are committed to the current development branch but have
not yet been confirmed as deployed to production. The numbered groups below
describe earlier code history and do not necessarily represent verified
production deployment boundaries.

## v0.9.0 — 2026-10-01

### Added

- Project updates and milestones on project and related opportunity records.
- Competitive Opportunity search by competitor and model.
- Trade Show lead follow-up Tasks, with configurable follow-up settings.
- Trade Show booth and resource links.

### Improved

- Opportunity Customer Context with Competitive Model and Competitive Pricing.
- Opportunity search filters and Trade Show resource presentation.
- CRM forms hide internal Account IDs and warn about duplicate Contacts.
- Opportunity draft recovery requires an explicit choice, preventing stale drafts from silently filling new Opportunities.

### Fixed

- Preserved historical inactive Contact links while blocking new inactive selections.

First–last commits (inclusive): `ee60ae1`–`7dd583f`

## v0.8.0 — 2026-09-29

### Added

- Demo inventory, requests, import, deployment tracking, and reporting, including unit-level returns and overdue/recovery views.

### Improved

- Demo import resolution, detail pages, Account filters, and responsive tables.
- Contact filtering, sorting, pagination, and status filters.
- Opportunity relationship cards and Reports navigation, wording, and Demo report placement.
- Activity Contact selection, assignment eligibility, duplicate Account warnings, and sales training permissions.
- Price Exception list visibility and revision import review.

First–last commits (inclusive): `f2523d7`–`0ff9fc9`

## v0.7.0 — 2026-09-27

### Added

- Price Exception source revision history, sales lookup, and import account-resolution workflow.
- Customer pricing for standard SKUs and special-configuration ODM products, with Account price provenance.

### Improved

- Price Exception and ODM import review, validation, and safeguards.
- Opportunity pricing and sales readiness checks.
- Sales lead handoff, follow-up, and archive safety.

### Fixed

- Strategic territory handling.

First–last commits (inclusive): `c5d8c5b`–`df2ed32`

## v0.6.0 — 2026-09-24

### Added

- Trade Show lead import, review, routing, conversion, contact resolution, and reporting.
- XLSX import and configurable Trade Show field mappings.
- Marketing audiences and Contact communication preferences.
- Customizable dashboards with report widgets.
- Secure document attachments for Accounts, Opportunities, and Projects.

### Improved

- Trade Show workflow, save feedback, and filter controls.

### Fixed

- Synchronized table scrolling and Opportunity client data serialization.

First–last commits (inclusive): `f4cc287`–`a2d426c`

## v0.5.0 — 2026-09-22

### Added

- ODM product SKUs, manual ODM product creation, and customer-specific ODM pricing.

### Improved

- ODM workbook review and customer import; custom SKUs use a unified ODM workflow.
- Reports landing page and Price Exception reporting wording.

First–last commits (inclusive): `0cc8c4a`–`1e00e3c`

## v0.4.0 — 2026-09-21

### Added

- Management reporting, saved reports, a role-aware dashboard, and forecast and sales target foundations.
- Account activity, product performance, channel partner, project, and Price Exception Usage reporting.
- Opportunity Customer Context.

### Improved

- Report building and navigation.

First–last commits (inclusive): `100babe`–`b2f8f60`

## v0.3.0 — 2026-09-20

### Added

- Price Exception management and import, with manual Account resolution.
- Price Exception pricing in Opportunities and salesperson visibility.

First–last commits (inclusive): `acd8c5d`–`0c107e8`

## v0.2.0 — 2026-09-20

### Added

- Google Workspace sign-in and role access.
- Projects and their relationships to Opportunities, plus Account addresses and administration settings.
- Searchable product SKU selection, product classification, and catalog filtering.

### Improved

- Account, Contact, Activity, Task, and Opportunity workflows, including Contacts without Accounts and multiple Projects per Opportunity.
- SalesHub branding, product selection, and pricing entry.

### Fixed

- Task workflow and archive handling; preserved Activity history when Project relationships change.

First–last commits (inclusive): `0cf87a0`–`8320947`

## v0.1.0 — 2026-09-16

### Added

- Initial CRM schema and migration baseline for Accounts, Contacts, Opportunities, Activities, Tasks, and supporting records.
- CRM shell and Account management.

### Improved

- Production deployment preparation for the foundation.

First–last commits (inclusive): `b72029d`–`6560169`

## Changelog maintenance

- Git remains the authoritative code history; this file summarizes user-facing and business-facing releases.
- Update Unreleased as features are committed; confirm deployment status before assigning a release.
- Move Unreleased items into a numbered release when deployed.
- Git tags may be created for major production releases.
