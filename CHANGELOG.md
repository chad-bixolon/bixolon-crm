# SalesHub Changelog

This changelog summarizes committed, user-facing SalesHub work. Versions below are
retrospective release groupings, not historical Git tags or verified deployment
boundaries. Dates are the dates of the last commits in each group.

## Unreleased

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
