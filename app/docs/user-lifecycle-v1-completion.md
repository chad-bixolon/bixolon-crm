# User Lifecycle Administration + Support Manager + Executive v1

Implementation is local and uncommitted. No deployment, push, DigitalOcean changes, or production-data changes were performed. Validation uses disposable PostgreSQL and the dedicated local E2E database. Node remains 22.23.4; Prisma remains 6.19.3.

## Roles and capability matrix

Added SUPPORT_MANAGER and EXECUTIVE. Existing users retain their roles. Functional responsibility is independent of job title and corporate domain. Executive is a parallel business reader, not a higher Sales Manager.

| Area | Support Manager | Executive |
| --- | --- | --- |
| Accounts / Contacts | Read | Company read |
| Opportunities / Pipeline / Projects | No Sales access | Company read |
| General Tasks / Activities | No general work access | Read |
| Support Cases | All Cases, create/edit, assignment, priority, archive/restore | All Cases read |
| Case Tasks / Activities | Case work and team Task assignment/priority corrections | Read through authorized context |
| Support workload / reports | Read aging, backlog, priority, follow-up, workload | Read |
| Support Inbox | Use | Denied |
| Mailbox connection management | Denied; separate capability | Denied |
| Support categories | Manage | Denied |
| Forecast / snapshots / movement | No unrelated Sales management access | Read |
| Sales Plans and planning reports | No | Read |
| Marketing / Trade Shows | No unrelated Marketing access | Read |
| Report definitions | No management | No management |
| Products / catalog | Read | Read |
| Negotiated pricing | Denied | Denied |
| Demo directory / context | No | Read |
| User Admin / configuration / System Health / Data Quality / integrations | Denied | Denied |

The executable capability matrix is `app/lib/authorization.ts`. Only Admin has `support-mailbox.manage`. Support and Support Manager both use the Inbox without Gmail connection, OAuth, or configuration administration. Support may work any Case and take it themselves; team reassignment, bulk assignment/priority changes, categories, team Task/Activity corrections, archive/restore, and reopening closed Cases require Support Manager or Admin.

## Ownership and assignment

Support Manager joins only Support Case and case-linked Task/Activity responsibility populations. Executive joins none. Sales Manager continues to carry Accounts, Opportunities, Projects, Sales Tasks, Sales Plans, quotas/targets, forecasts, and attribution. Delegation does not change those semantics. All new assignment populations require active, unarchived users. Historical attribution and shared Sales visibility remain intact.

## User Administration and lifecycle

Create/edit includes Unicode first/last names, email, role explanations, Active/Inactive status, timezone, and an Admin-only delegated User Administration selector. The list says “Not archived” when showing active and inactive users together. Archived users remain readable; no new archive/delete action was introduced.

Eligibility-losing changes calculate counts before persistence and require explicit acknowledgment. Counts cover active Accounts, open Opportunities, active Projects, open Sales/Support Tasks, unresolved Cases, actionable Trade Show Sales routing, current Trade Show Marketing ownership, outstanding Price Exception follow-up, outstanding Demos, and current/future Sales Plans and targets. Changed user inputs or impact counts invalidate the prior confirmation. Existing attribution remains unchanged. Emergency deactivation remains possible with another usable true Admin; no forced reassignment is imposed.

The existing transaction lock and final active/unarchived Admin safeguard remain authoritative. The UI explains the safeguard. Delegated Sales Managers do not satisfy it.

## Timezone and identity

Admin and personal preferences share `User.timeZone`. Named IANA zones supported by the runtime, including Asia/Seoul, are accepted. Existing defaults, business dates, and scheduling semantics are preserved.

User detail shows Google account linked / Not yet linked, with recovery when authorized. Recovery verifies the confirmation email, rechecks persisted authority, removes the link and records history transactionally. Creating a SalesHub user does not create a Google account. Changing the SalesHub email does not transfer a stable Google identity. Resetting the link does not modify Google credentials. Normal UI and history expose no Google subject, OAuth token, or credential material.

## History and delegated administration

The existing append-only AdminMaintenanceEvent now has nullable oldValue/newValue fields. It records creation, role/status/email/timezone changes, delegation changes, and identity reset. User detail shows the most recent 100 events with actor and timestamp; older events remain retained. There is no new history table.

`User.delegatedUserAdministrationEnabled` defaults false. Only active, unarchived SALES_MANAGER users receive the fixed additional `users.manage` capability. Only true Admins can grant/revoke it or manage Admin/delegated identities. Delegated managers cannot promote users to Admin or grant delegation. Configuration/import/maintenance entry points formerly reusing users.manage now use configuration.manage. There is no arbitrary permission matrix or multiple-role composition.

## HQ identity policy and deferred work

Trusted domains are unchanged. Future approval of bixolon.com alongside bixolonusa.com is an identity-policy requirement, separate from roles. Korean/Unicode names are supported. HQ users should receive the functional role appropriate to their work. Business Viewer is only a future evaluation item.

Deferred: user import/export, Marketing User, HQ/Corporate roles, Business Viewer implementation, custom permissions, multiple functional roles, multi-tenancy, and multi-domain authentication. No business-date or scheduler redesign was performed.

## Migrations

- `20261022120000_user_lifecycle_roles`: only the two additive PostgreSQL UserRole enum values.
- `20261022121000_user_lifecycle_administration`: false-default delegated flag and nullable oldValue/newValue history fields.

Migration validation includes replay, schema parity, existing-row fingerprints, default values, and preserved foreign keys. No migration was applied to production.

## Validation

- Complete unit/regression suite: 1,518 passed, 0 failed, 1 existing opt-in SQL-fixture test skipped (`RUN_PROSPECT_SQL_TEST` not enabled).
- Focused authorization/lifecycle/mailbox checks after final policy separation: 58 passed. Includes negative direct server-action tests for Executive and READ_ONLY, pricing-query exclusion for Support/Support Manager/Executive, delegated access boundaries, and impact/history tests.
- Four dashboard regression test files passed after the Support dashboard presentation correction.
- Playwright: 15 distinct scenarios passed across the authorization and lifecycle suites. The lifecycle suite covers 1440, 1024, 820, 768, and 390 px, role/status impact confirmation, Unicode/timezone persistence, identity status/reset history, Executive leadership routes, and Support Manager case-Task reassignment/priority correction. Uncaught application errors and hydration errors fail these tests.
- Final `npm run typecheck`: passed with Node 22.23.4 and Prisma 6.19.3.
- Final lint: passed.
- Production Webpack build (`npm run build -- --webpack`): passed.
- Production Docker build (`--target production`): passed; local image `saleshub-user-lifecycle-validation:local`.
- Migration replay/preservation: passed completely, including fresh replay, populated upgrade, schema parity, repeated deployment, both new migrations’ user/history/business-data fingerprints and defaults, foreign keys, append-only history, and negative constraint checks. Disposable databases and networks were removed.
- `git diff --check`: passed.

The initial browser selector failures and stale role-policy test expectations were corrected and rerun successfully. The complete suite required unsandboxed local subprocess execution; Docker validation used only local disposable/test resources.

## Final pre-commit review

The review found and corrected Executive pricing exposure through Opportunity product details, Product Performance unit-price/provenance output, and shared Price Exception Usage reports. Negotiated-pricing access now consistently requires `pricing.read`; business revenue totals remain visible. Executive report discovery and execution were corrected for Snapshot/Movement links, Opportunity Snapshot History, engagement reports, and permitted built-in reports. Read-only report execution does not grant report-definition saving. The Support Manager team Task dashboard label now describes team assignments accurately. Admin retains its existing personal Support Task dashboard scope. Support category navigation now sends Support Managers back to Cases instead of the unauthorized Administration landing page.

Support policy overlap remains for business review; existing Support rights were not removed:

| Support function | Support | Support Manager |
| --- | --- | --- |
| View all Cases; day-to-day Case work | Yes | Yes |
| Claim an unassigned Case by assigning it to self | Yes | Yes |
| Assign/reassign team Cases; Case priority | Yes | Yes |
| Bulk Case assignment/priority | Yes | Yes |
| Create case Tasks / Activities with eligible responsibility | Yes | Yes |
| Edit existing case Tasks | Own assigned work, or own unassigned work; assignment/priority locked | Eligible team case Tasks, including assignment/priority correction |
| Correct existing case Activities | No | Yes, case-scoped |
| Team Case reports / workload / aging / backlog | Yes | Yes |
| Dashboard case Task scope | Personal | Team |
| Support Inbox | Yes | Yes |
| Support categories | No | Yes |
| Case reopen / archive / restore | Yes | Yes |
| Mailbox connection management | Existing right retained | No |
| Unrelated Sales/Marketing/pricing/admin/maintenance | No | No |

Support Manager therefore adds real team Task/Activity correction and category authority, but it is not an exclusive Case-management tier. Before committing, decide whether the preserved team Case and mailbox rights are the intended Support boundary. Restricting those existing rights requires a deliberate policy decision.

The review found no delegated privilege escalation: only persisted active/unarchived Sales Managers receive the fixed user-administration grant; only true Admins can alter administrative identities or delegation. Ownership, forecasts, quotas, attribution, and Sales presentation remain role-based. The final-Admin safeguard still counts only true Admins.

Both migrations remain exactly as approved, with no additional migration or SQL change during review. Prior clean replay and populated-upgrade validation, including all-table preservation fingerprints, remain applicable. Identity linkage, trusted-domain configuration, scheduler/business-date code, and historical business ownership are unchanged. Lifecycle history uses the explicit field whitelist in `saveUser`; identity reset records no identity subject or credential values.

Remaining legacy role checks mostly express true-Admin boundaries, Sales responsibility, historical filtering, or presentation. Existing duplicate Sales-rep arrays in pricing/target services still match the central eligibility population and exclude both new roles. Role dashboard-default administration still offers its existing role subset; the two new roles use the new system layouts. Support now has a Reports navigation link to reports it could already read; this does not grant new report permissions. User archive/delete remains unavailable, historical users are readable, and user import/export plus multi-domain authentication remain deferred.

### Review validation

- Full regression run: 1,521 tests, initially 1,514 passed, six failed because the Opportunity page test mock lacked the new Snapshot-history helper, and one existing opt-in SQL test skipped. The mock was corrected; all 102 affected reporting/Snapshot/dashboard/lifecycle retests passed. The final Support dashboard scope test file also passed both tests.
- All ten lifecycle browser scenarios passed across the run and targeted reruns, including all five requested widths, Executive report execution and pricing exclusion, identity recovery, lifecycle impact/history, and Support Manager category navigation/team Task corrections. The missing dashboard import caught during validation was corrected before the successful reruns.
- Standalone lint and typecheck passed. Production Webpack build passed. Final production Docker build passed as `saleshub-user-lifecycle-review:local`, including the final Support presentation corrections and its TypeScript/build checks.
- Both unchanged migrations retain the prior successful clean replay/populated-upgrade/preservation evidence. No migration or production data was changed during review.
- Generated `next-env.d.ts` churn was removed. `git diff --check` passed. No commit, push, deployment, or DigitalOcean operation occurred.

## Files changed

- `app/app/accounts/[id]/page.tsx`
- `app/app/activities/[id]/edit/page.tsx`
- `app/app/activities/[id]/page.tsx`
- `app/app/activities/actions.ts`
- `app/app/activities/new/page.tsx`
- `app/app/administration/competitors/actions.ts`
- `app/app/administration/competitors/page.tsx`
- `app/app/administration/currencies/actions.ts`
- `app/app/administration/currencies/page.tsx`
- `app/app/administration/dashboard-views/page.tsx`
- `app/app/administration/forecast-snapshots/actions.ts`
- `app/app/administration/forecast-snapshots/page.tsx`
- `app/app/administration/history/actions.ts`
- `app/app/administration/imports/accounts-contacts/page.tsx`
- `app/app/administration/imports/actions.ts`
- `app/app/administration/imports/demos/actions.ts`
- `app/app/administration/imports/demos/backfill/actions.ts`
- `app/app/administration/imports/demos/backfill/page.tsx`
- `app/app/administration/imports/demos/page.tsx`
- `app/app/administration/imports/page.tsx`
- `app/app/administration/imports/price-exceptions/actions.ts`
- `app/app/administration/imports/price-exceptions/page.tsx`
- `app/app/administration/imports/price-exceptions/rosa/actions.ts`
- `app/app/administration/imports/price-exceptions/rosa/page.tsx`
- `app/app/administration/imports/products/actions.ts`
- `app/app/administration/imports/products/page.tsx`
- `app/app/administration/labels/actions.ts`
- `app/app/administration/labels/page.tsx`
- `app/app/administration/lookups/[kind]/actions.ts`
- `app/app/administration/lookups/[kind]/page.tsx`
- `app/app/administration/opportunity-snapshots/actions.ts`
- `app/app/administration/opportunity-snapshots/page.tsx`
- `app/app/administration/outcome-reasons/actions.ts`
- `app/app/administration/outcome-reasons/page.tsx`
- `app/app/administration/ownership/page.tsx`
- `app/app/administration/page.tsx`
- `app/app/administration/price-exceptions/actions.ts`
- `app/app/administration/price-exceptions/page.tsx`
- `app/app/administration/sales-stages/actions.ts`
- `app/app/administration/sales-stages/page.tsx`
- `app/app/administration/sales-targets/actions.ts`
- `app/app/administration/sales-targets/page.tsx`
- `app/app/administration/settings/actions.ts`
- `app/app/administration/settings/page.tsx`
- `app/app/administration/support-case-categories/page.tsx`
- `app/app/administration/users/[id]/edit/page.tsx`
- `app/app/administration/users/actions.ts`
- `app/app/administration/users/new/page.tsx`
- `app/app/administration/users/page.tsx`
- `app/app/contacts/[id]/page.tsx`
- `app/app/dashboard-actions.ts`
- `app/app/demos/page.tsx`
- `app/app/layout.tsx`
- `app/app/my-integrations/page.tsx`
- `app/app/notes/actions.ts`
- `app/app/notes/new/page.tsx`
- `app/app/opportunities/[id]/page.tsx`
- `app/app/page.tsx`
- `app/app/price-exceptions/[id]/actions.ts`
- `app/app/price-exceptions/[id]/layout.tsx`
- `app/app/price-exceptions/[id]/page.tsx`
- `app/app/price-exceptions/account-search/route.ts`
- `app/app/reports/new/account-activity-builder.tsx`
- `app/app/reports/new/channel-partner-builder.tsx`
- `app/app/reports/new/page.tsx`
- `app/app/reports/new/product-performance-builder.tsx`
- `app/app/reports/new/project-initiative-builder.tsx`
- `app/app/reports/page.tsx`
- `app/app/reports/sales-plan/page.tsx`
- `app/app/support/cases/page.tsx`
- `app/app/support/inbox/actions.ts`
- `app/app/support/inbox/page.tsx`
- `app/app/tasks/[id]/edit/page.tsx`
- `app/app/tasks/[id]/page.tsx`
- `app/app/tasks/new/page.tsx`
- `app/auth.ts`
- `app/components/admin-audit-page.tsx`
- `app/components/admin-integration-history.tsx`
- `app/components/report-results.tsx`
- `app/components/shell.tsx`
- `app/components/user-form.tsx`
- `app/components/work-form.tsx`
- `app/docs/authentication.md`
- `app/docs/authorization-policy.md`
- `app/docs/user-lifecycle-v1-completion.md`
- `app/e2e/constants.mjs`
- `app/e2e/seed.mjs`
- `app/e2e/user-lifecycle.spec.ts`
- `app/lib/account-detail.ts`
- `app/lib/accounts.ts`
- `app/lib/assignment-eligibility.ts`
- `app/lib/authorization.ts`
- `app/lib/dashboard-widgets.ts`
- `app/lib/dashboard.ts`
- `app/lib/dev-impersonation.ts`
- `app/lib/engagement.ts`
- `app/lib/help/topics.ts`
- `app/lib/opportunity-history.ts`
- `app/lib/opportunity-snapshots.ts`
- `app/lib/outcome-reasons.ts`
- `app/lib/price-exception-account-create.ts`
- `app/lib/price-exception-cleanup.ts`
- `app/lib/price-exception-lifecycle.ts`
- `app/lib/price-exception-maintenance.ts`
- `app/lib/price-exception-resolution.ts`
- `app/lib/recent-items.ts`
- `app/lib/reporting.ts`
- `app/lib/role-labels.ts`
- `app/lib/sales-plan-sku-rollup.ts`
- `app/lib/sales-targets.ts`
- `app/lib/saved-views.ts`
- `app/lib/snapshot-capture-identity.ts`
- `app/lib/support-cases.ts`
- `app/lib/support-dashboard.ts`
- `app/lib/support-gmail-connection.ts`
- `app/lib/support-report.ts`
- `app/lib/support-work.ts`
- `app/lib/user-lifecycle.ts`
- `app/lib/user-time-zone.ts`
- `app/lib/users.ts`
- `app/prisma/migrations/20261022120000_user_lifecycle_roles/migration.sql`
- `app/prisma/migrations/20261022121000_user_lifecycle_administration/migration.sql`
- `app/prisma/schema.prisma`
- `app/scripts/test-migrations.py`
- `app/tests/administration-page.test.mjs`
- `app/tests/auth.test.mjs`
- `app/tests/authorization-foundation.test.mjs`
- `app/tests/crm.test.mjs`
- `app/tests/demo-import.test.mjs`
- `app/tests/demo-ui.test.mjs`
- `app/tests/opportunity-detail-layout.test.mjs`
- `app/tests/price-exceptions.test.mjs`
- `app/tests/product-performance-reporting.test.mjs`
- `app/tests/sales-plan-report-filters.test.mjs`
- `app/tests/shell.test.mjs`
- `app/tests/support-cases.test.mjs`
- `app/tests/support-dashboard.test.mjs`
- `app/tests/user-admin.test.mjs`
- `app/tests/user-lifecycle.test.mjs`
- `app/types/next-auth.d.ts`
