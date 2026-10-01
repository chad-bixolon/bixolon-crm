# SalesHub Changelog

This changelog summarizes committed, user-facing SalesHub work. Versions below are
retrospective release groupings, not historical Git tags or verified deployment
boundaries. Dates are the dates of the last commits in each group.

## Unreleased

No commits are assigned here because the repository does not identify the Git
commit currently deployed. The numbered groups below describe code history,
not confirmed production releases.

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
