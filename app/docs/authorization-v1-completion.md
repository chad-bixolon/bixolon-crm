# Authorization Correctness & Policy Foundation v1 completion

Implemented without a schema migration, new roles, custom permissions, commits, pushes, deployment, DigitalOcean changes, or production-data changes. Node remains pinned to 22.23.4; Prisma and deployment configuration are unchanged.

## Findings fixed

| Severity | Finding | Implementation |
| --- | --- | --- |
| Critical | Direct user administration mutation lacked authorization | `submitUser` now checks `users.manage` before parsing. `saveUser` independently checks capability, reloads/locks the persisted actor, validates input, and whitelists persisted fields. |
| High | Product detail disclosed negotiated pricing to catalog-only users | `productDetailData` excludes customer-price rows from the query without `pricing.read`; the server component also gates the sensitive pricing section. Ordinary catalog tiers and metadata remain visible. |
| Medium | Individual/bulk Task scope mismatch | Shared `taskEditWhere` / `assertTaskEdit` restrict Sales to assigned work and authorized Projects. Individual saves enforce the predicate under the Task lock. Edit links, edit pages, archive and restore also check it. |
| Audit inconsistency | Support case Task notification/reassignment eligibility | Explicit Task-kind eligibility is used for notices and each selected bulk reassignment target. Support can receive case Task notices and remains excluded from general CRM Task assignment. |
| Medium | Sales Plan import accepted unavailable owners | Preview, submitted review, and transactional revalidation require active, unarchived Sales/Sales Manager owners. Historical plans and attribution remain intact. |
| Medium | Last usable Admin could be removed | User writes serialize on a transaction advisory lock; role/status changes cannot remove the final active, unarchived Admin. Concurrent removal regression passes. There is no existing application User archive/delete path; the central invariant helper covers archive state for a future caller using the same lock. |

## Architecture and capability changes

`predefinedCapabilities` is the explicit matrix consumed by `can`, `requirePermission`, `requireMutation`, and `assertPermission`. Implicit `sales.read → opportunities.read` and `tasks.write → support-work.write` grants are now explicit entries. All 31 legacy capabilities retain the same access decisions across the six roles (186 comparisons).

New capabilities: `reports.operational.read`, `reports.engagement.read`, `reports.create`, `reports.share`, `snapshots.read`, `pipeline-movement.read`, `forecast.read`, `support-inbox.write`, `data-quality.manage`, `system-health.read`, and `maintenance.manage`.

Capabilities authorize an operation; persisted record policy limits which records can change; eligibility chooses valid new owners/assignees. Existing storage helpers remain trusted primitives where documented; page/proxy access alone is insufficient authorization. User persistence performs its own checks independently.

Explicit eligibility policies: `account-owner`, `opportunity-owner`, `project-owner`, `sales-plan-owner`, `general-task`, `support-task`, `support-case`, `trade-show-sales`, and `marketing-owner`. `eligibleUserWhere`, `eligibleUser`, `activeSalesRepWhere`, and `taskAssigneePolicy` apply these populations consistently. New Sales owners exclude Admin. Admin remains eligible for operational Tasks and Support Cases because existing workflows explicitly use Admin assignees. Historical attribution is retained.

Shared Sales read visibility, other-rep filters, Pipeline defaults, and revenue/forecast/commission ownership attribution are preserved. Task scope follows responsibility, without applying new Task rules to Activity history. Bulk work intentionally remains limited to unfinished operational Tasks; individual forms can reopen/restore. Support retains its restricted individual case-Task editor without general bulk access.

## Intentionally retained direct role checks

- Sales responsibility/query defaults in `authorization.ts`, `task-policy.ts`, `projects.ts`, `opportunities.ts`, `sales-plan.ts`, and existing personal/filter scopes.
- Admin report-definition ownership overrides and Sales Trade Show report scopes in `reporting.ts`.
- Human Admin versus trusted service capture identity in `opportunity-snapshots.ts` and `snapshot-capture-identity.ts`.
- The Admin-specific last-Admin invariant in `users.ts`, and the persisted-role consistency check in `support-work.ts`.
- Identity/impersonation protections, dashboard defaults, navigation labels, and other presentation-only role decisions.

These express record responsibility, attribution, or authenticated actor identity rather than new owner eligibility derived from edit permission.

## Read Only certification

**No business-record mutation, with explicit personal-preference exceptions.**

The action/API review and negative regressions cover CRM business records, users, pricing/SKUs, Support Cases, Products, Projects, Opportunities, Accounts/Contacts, operational Tasks, Activities/Notes, reports, Trade Shows, Marketing, imports/maintenance, documents, and Sales Plans. Personal exceptions remain scoped to the authenticated user's own Saved Views, notifications/preferences, Recent Items, dashboard preferences, timezone, session, and personal Calendar connection/sync state. Calendar-to-CRM Activity creation remains protected.

See [the authorization policy and role matrix](authorization-policy.md) for the full policy, maintained scope distinctions, and last-Admin transaction contract.

## Deferred scope

Support Manager, Executive, Marketing User, HQ/Corporate, custom roles, user import/export, and affected-work previews remain unimplemented. Mechanical replacement of every presentation role check is intentionally deferred. No schema migration was added.

## Validation

Validation uses Node 22.23.4. Browser/database fixtures use only the isolated local E2E database. No live provider calls or production mutations are part of these checks.

| Check | Result |
| --- | --- |
| Lint | PASS |
| Typecheck | PASS |
| Full unit/regression suite | 1,505 passed, 0 failed, 1 existing opt-in SQL test skipped (`RUN_PROSPECT_SQL_TEST` unset) |
| Focused authorization regressions | Six focused test files passed; direct-call denials, actor availability, forged payloads, pricing query/output, Task parity, Support eligibility, Sales Plan owners, last Admin, and eligibility populations covered |
| Relevant Playwright suite | 25 passed, including new authorization/database concurrency, Admin form, pricing HTML, auth, bulk work, Support work, and existing product polish |
| Additional release Support browser focus | 6 passed |
| Release browser smoke | 3 passed |
| Production Webpack build | PASS through `npm run build -- --webpack` |
| Production Docker build | PASS; local `saleshub-auth-policy-v1:local`, Node 22.23.4 base; image not deployed |
| Migration/schema/config diff | None; migration replay not required |
| `git diff --check` | PASS |

`npm run release:check -- --base HEAD --allow-dirty` performs the final development gate and writes timestamped evidence under `app/reports/release/`. The candidate deliberately remains uncommitted, so the release result is **NOT READY** by design even when all applicable validation stages pass. This is not deployment approval. The earlier focused gate also passed all runtime checks; its final repository fingerprint detected the final Activity-attribution correction made during validation, prompting a fresh gate against the fixed file set.


## Final pre-commit review (2026-10-22)

The original 71-file inventory contained no unrelated or unnecessary production changes. Review found a Task edit-link mismatch: the detail page could offer the restricted case-editor fallback to a general Task writer, and the Case Task list offered edit links using module permission without record scope. Both links now follow the existing general Task policy, while Support retains its restricted editor. Mutation enforcement and shared read visibility are unchanged. The Case detail page is the one necessary additional production file, bringing this inventory to 72 files. The bulk-actions documentation also now describes Sales owner eligibility independently of write permission.

The detail-page regression failed before its correction. A new browser regression reproduced the Case Task list mismatch before correction, then passed for Sales, Admin, and Support, including shared visibility and denial of the direct Sales edit URL. After the corrections, all eight affected unit/regression files, all nine authorization/Support browser checks, lint, production TypeScript checking, the production Webpack build, and `git diff --check` passed. The full-suite and Docker evidence above records the original implementation validation; this follow-up changes only edit-link visibility, regression coverage, and these documentation/inventory details.

## Files changed

72 files total (runtime/policy, tests, and documentation).


### Policy and services

- [app/lib/accounts.ts](../lib/accounts.ts)
- [app/lib/admin-maintenance.ts](../lib/admin-maintenance.ts)
- [app/lib/admin-ownership.ts](../lib/admin-ownership.ts)
- [app/lib/assignment-eligibility.ts](../lib/assignment-eligibility.ts)
- [app/lib/authorization.ts](../lib/authorization.ts)
- [app/lib/bulk-actions.ts](../lib/bulk-actions.ts)
- [app/lib/data-quality-bulk.ts](../lib/data-quality-bulk.ts)
- [app/lib/data-quality.ts](../lib/data-quality.ts)
- [app/lib/help/topics.ts](../lib/help/topics.ts)
- [app/lib/import-plan.ts](../lib/import-plan.ts)
- [app/lib/notifications.ts](../lib/notifications.ts)
- [app/lib/opportunities.ts](../lib/opportunities.ts)
- [app/lib/opportunity-snapshots.ts](../lib/opportunity-snapshots.ts)
- [app/lib/pipeline-movement-report.ts](../lib/pipeline-movement-report.ts)
- [app/lib/product-detail-data.ts](../lib/product-detail-data.ts)
- [app/lib/projects.ts](../lib/projects.ts)
- [app/lib/reporting.ts](../lib/reporting.ts)
- [app/lib/sales-plan-import.ts](../lib/sales-plan-import.ts)
- [app/lib/sales-plan.ts](../lib/sales-plan.ts)
- [app/lib/support-case-ui.ts](../lib/support-case-ui.ts)
- [app/lib/support-cases.ts](../lib/support-cases.ts)
- [app/lib/support-gmail-connection.ts](../lib/support-gmail-connection.ts)
- [app/lib/support-notifications.ts](../lib/support-notifications.ts)
- [app/lib/task-policy.ts](../lib/task-policy.ts)
- [app/lib/trade-show-follow-up.ts](../lib/trade-show-follow-up.ts)
- [app/lib/trade-show-routing.ts](../lib/trade-show-routing.ts)
- [app/lib/trade-shows.ts](../lib/trade-shows.ts)
- [app/lib/users.ts](../lib/users.ts)
- [app/lib/work-notification-evaluator.ts](../lib/work-notification-evaluator.ts)
- [app/lib/work-options.ts](../lib/work-options.ts)
- [app/lib/work.ts](../lib/work.ts)

### Pages and actions

- [app/app/administration/data-quality/page.tsx](../app/administration/data-quality/page.tsx)
- [app/app/administration/ownership/page.tsx](../app/administration/ownership/page.tsx)
- [app/app/administration/system-health/page.tsx](../app/administration/system-health/page.tsx)
- [app/app/administration/users/actions.ts](../app/administration/users/actions.ts)
- [app/app/products/[id]/product-details.tsx](../app/products/[id]/product-details.tsx)
- [app/app/projects/[id]/edit/page.tsx](../app/projects/[id]/edit/page.tsx)
- [app/app/projects/new/page.tsx](../app/projects/new/page.tsx)
- [app/app/reports/forecast/page.tsx](../app/reports/forecast/page.tsx)
- [app/app/support/cases/[id]/page.tsx](../app/support/cases/[id]/page.tsx)
- [app/app/support/inbox/actions.ts](../app/support/inbox/actions.ts)
- [app/app/support/inbox/page.tsx](../app/support/inbox/page.tsx)
- [app/app/tasks/[id]/edit/page.tsx](../app/tasks/[id]/edit/page.tsx)
- [app/app/tasks/[id]/page.tsx](../app/tasks/[id]/page.tsx)
- [app/app/tasks/actions.ts](../app/tasks/actions.ts)
- [app/app/trade-shows/[id]/edit/page.tsx](../app/trade-shows/[id]/edit/page.tsx)
- [app/app/trade-shows/[id]/leads/[leadId]/edit/page.tsx](../app/trade-shows/[id]/leads/[leadId]/edit/page.tsx)
- [app/app/trade-shows/[id]/page.tsx](../app/trade-shows/[id]/page.tsx)
- [app/app/trade-shows/my-leads/page.tsx](../app/trade-shows/my-leads/page.tsx)
- [app/app/trade-shows/new/page.tsx](../app/trade-shows/new/page.tsx)

### Tests

- [app/e2e/authorization-foundation.spec.ts](../e2e/authorization-foundation.spec.ts)
- [app/tests/admin-audit.test.mjs](../tests/admin-audit.test.mjs)
- [app/tests/assignment-eligibility.test.mjs](../tests/assignment-eligibility.test.mjs)
- [app/tests/auth.test.mjs](../tests/auth.test.mjs)
- [app/tests/authorization-foundation.test.mjs](../tests/authorization-foundation.test.mjs)
- [app/tests/create-user-defaults.test.mjs](../tests/create-user-defaults.test.mjs)
- [app/tests/data-quality-bulk.test.mjs](../tests/data-quality-bulk.test.mjs)
- [app/tests/data-quality.test.mjs](../tests/data-quality.test.mjs)
- [app/tests/notification-center.test.mjs](../tests/notification-center.test.mjs)
- [app/tests/product-action-visibility.test.mjs](../tests/product-action-visibility.test.mjs)
- [app/tests/sales-plan.test.mjs](../tests/sales-plan.test.mjs)
- [app/tests/support-case-work.test.mjs](../tests/support-case-work.test.mjs)
- [app/tests/support-cases.test.mjs](../tests/support-cases.test.mjs)
- [app/tests/task-workflow.test.mjs](../tests/task-workflow.test.mjs)
- [app/tests/trade-shows.test.mjs](../tests/trade-shows.test.mjs)
- [app/tests/user-admin.test.mjs](../tests/user-admin.test.mjs)
- [app/tests/work-notifications.test.mjs](../tests/work-notifications.test.mjs)

### Documentation

- [app/docs/authentication.md](../docs/authentication.md)
- [app/docs/authorization-policy.md](../docs/authorization-policy.md)
- [app/docs/authorization-v1-completion.md](../docs/authorization-v1-completion.md)
- [app/docs/bulk-actions.md](../docs/bulk-actions.md)
- [app/docs/release-checklist.md](../docs/release-checklist.md)
