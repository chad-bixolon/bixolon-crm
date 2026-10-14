# Support Email port comparison and plan

Comparison performed before editing main on 2026-10-13. Main was clean at `1734b01`; POC worktree branch was `support-email-poc` at `b67d445`. The merge base is `b67d445`. All validated POC feature changes were **uncommitted worktree files**; branch-to-branch diff alone would omit the implementation. The POC worktree was read only throughout this task. Its .env/token contents were not copied.

## Current review grouping, October 14

The working tree contains **71 candidate source files**: 32 modified tracked files and 39 untracked files. Nothing is staged or committed. The reviewed file lists assign every candidate exactly once across these proposed commits:

1. **Upgrade Next.js to 16.3.6** — 2 files: `app/package.json` and `app/package-lock.json`. Next.js, its platform packages and matching ESLint configuration move together; React and unrelated dependencies are unchanged.
2. **Add production Support Email integration and recovery safeguards** — 66 files: Inbox/OAuth routes; Account/Case email context; signed intake and explicit private attachment import; encrypted PostgreSQL credentials; the additive `20261013230000_support_email_production` migration; environment/Compose defaults; textarea improvements; tests and Support documentation. This includes the final P2 fixes: failed-first/newest-first attachment review with bounded linked-message and failed-source paging, missing-origin recovery with exact provenance and per-source retry states, and atomic Link/Ignore dismissal handling with idempotent retries. Existing GIN/Calendar index declarations and the integrity verifier's six exact existing cascade exceptions are metadata/test corrections, not new production DDL. The P2 fixes add no schema or migration changes. Normal Google authentication code is unchanged.
3. **Document local Docker recovery and stabilize E2E role switching** — 3 files: `app/docs/deployment.md`, `app/e2e/helpers.ts`, and `app/e2e/support-attachments.spec.ts`. These document portable recovery, prevent late requests from restoring a previous test session, and check Support write controls before attachment removal. This commit follows the integration because the deployment document links to its rollout guide.

The P2 changes overlap files introduced by the integration; retaining the final implementation together avoids reconstructing an intermediate feature state with known defects. The final P2 phase passed 50 focused unit tests, 14 Playwright tests, lint, typecheck, the production build and tracked-diff whitespace checks. These are separate from the earlier full-suite results; see the [validation record](support-email-validation.md). Exact commit commands and per-file classifications remain local review artifacts and are not product source.

Keep `compose.override.yml`, actual `.env` files, PostgreSQL clusters, backups/checksum/fingerprint artifacts, runtime inspection/build scripts under `app/reports/`, generated caches/reports, dependency directories and local Docker resources out of the commit. The server-specific database bind and `create_host_path: false` guard remain in the ignored override. No POC runtime, credentials, database history or localhost OAuth client is part of main's candidate files. See the [updated validation record](support-email-validation.md) for restored runtime and focused test evidence. Review must precede any commit or DigitalOcean deployment.

## Main changes during isolation

Current main adds responsive filters, global search, operational health/jobs/notification preferences, saved views/close-period support, recent items, updated sign-in/menu interactions, data-quality dashboard and role dashboards. New main migrations are `20261012120000_operational_maturity`, `20261012150000_saved_views`, and `20261013120000_recent_items`. Existing dependency/runtime updates remain. Overlap resolution keeps RecentView on Account/Case detail, SavedViews and mobile filter disclosure on the Case list, and current work-form context behavior. No unrelated main pages/auth/navigation implementation were replaced. Full migration replay exposed pre-existing schema/verification drift: the port also declares existing SQL GIN search indexes in Prisma, maps the existing truncated Calendar unique-index name, and updates the foundation integrity assertion to permit only six exact intentional Calendar/preference cascade edges. These changes add no production DDL or new cascades.

```text
1734b01 Polish role-based dashboards
9f9b75a Condense top menu nav so items show under user
9eec989 Add recent event list to top menu
fcbe758 Add admin data quality dashboard
f642a06 Polish SalesHub interactions and sign-in
ac63ad6 Add saved views and opportunity close period
4616e5f Fix forecast snapshot capture feedback
0cad762 Add global search and operational health tools
6fa3731 Add global search and operational health tools
d05018a Improve responsive filter usability
```

## POC worktree inventory

The complete Git inventory below captures tracked modifications and new directories/files. The four POC migration directories were reviewed against main: no corresponding email/dismissal/provenance models existed there. Their final schema is consolidated in one new additive production migration, avoiding the obsolete recipients create/drop sequence.

```text
 M .gitignore
 M app/.dockerignore
 M app/app/accounts/[id]/page.tsx
 M app/app/globals.css
 M app/app/sign-in/page.tsx
 M app/app/support/cases/[id]/page.tsx
 M app/app/support/cases/actions.ts
 M app/app/support/cases/new/page.tsx
 M app/app/support/cases/page.tsx
 M app/auth.ts
 M app/components/support-attachments.tsx
 M app/components/support-case-form.tsx
 M app/components/support-case-timeline.tsx
 M app/components/work-form.tsx
 M app/e2e/seed.mjs
 M app/lib/authorization.ts
 M app/lib/e2e-auth.ts
 M app/lib/related-support-cases.ts
 M app/lib/support-attachments.ts
 M app/lib/support-case-display.ts
 M app/lib/support-case-timeline.ts
 M app/lib/support-cases.ts
 M app/next-env.d.ts
 M app/playwright.config.ts
 M app/prisma/schema.prisma
 M app/tests/e2e-auth.test.mjs
 M app/tests/support-case-form-state.test.mjs
 M app/tests/support-integration.test.mjs
 M app/tests/work.test.mjs
 M app/tsconfig.json
?? app/app/api/support-gmail/
?? app/app/support/cases/[id]/email-attachments/
?? app/app/support/inbox/
?? app/components/account-support-emails.tsx
?? app/components/email-file-selection.tsx
?? app/components/expanding-textarea.tsx
?? app/docs/support-email-poc.md
?? app/docs/support-poc-runtime.md
?? app/e2e/support-email-identity.spec.ts
?? app/e2e/support-email-poc.spec.ts
?? app/e2e/support-textareas.spec.ts
?? app/lib/support-email-file-import.ts
?? app/lib/support-email-poc.ts
?? app/lib/support-email-source.ts
?? app/lib/support-gmail-config.ts
?? app/lib/support-gmail-connection.ts
?? app/lib/support-gmail-files.ts
?? app/lib/support-gmail.ts
?? app/lib/support-inbox-display.ts
?? app/lib/support-poc-auth-cookies.ts
?? app/playwright.support-poc.config.ts
?? app/prisma/migrations/20261009200000_support_email_poc/
?? app/prisma/migrations/20261009210000_support_email_poc_minimize/
?? app/prisma/migrations/20261011120000_support_inbox_dismissal/
?? app/prisma/migrations/20261013220000_support_email_attachment_source/
?? app/scripts/seed-support-poc-stress.mjs
?? app/scripts/support-gmail-auth-browser.mjs
?? app/scripts/support-poc-browser-smoke.mjs
?? app/scripts/support-poc-dry-run.mjs
?? app/scripts/support-poc-regression.mjs
?? app/scripts/verify-support-poc-stress.mjs
?? app/tests/support-email-files.test.mjs
?? app/tests/support-email-identity.test.mjs
?? app/tests/support-email-intake.test.mjs
?? app/tests/support-email-poc.test.mjs
?? app/tests/support-gmail-auth.test.mjs
?? app/tests/support-inbox-display.test.mjs
?? compose.support-poc-dry-run-test.yml
?? compose.support-poc.yml
```

## Port decisions

| POC area | Main integration |
| --- | --- |
| Inbox routes/components, Gmail helpers, signed intake/files, matching and manual CRM actions | Ported; `support-email-poc.ts` becomes `support-email.ts`; strict read-only scope/API behavior preserved |
| Support Case actions/service/form/detail/timeline/attachment and Account Support integration | Merged into current main; atomic transaction and duplicate protections preserved |
| New Description / Note fields and CSS | Ported with conditional email sizing and autosizing Note |
| Four POC migrations/schema relations | Final schema consolidated into `20261013230000_support_email_production`; applied main migrations unchanged |
| Filesystem encrypted connection | Replaced with singleton `SupportGmailConnection`; existing per-user Calendar model does not safely fit shared mailbox/client/scope |
| Localhost origin/database/callback guard | Replaced with production flag, canonical HTTPS AUTH_URL/callback, expected DB identity/TLS; live Gmail unavailable locally |
| POC sign-in/auth-cookie/E2E-auth exceptions | Excluded; existing main authentication and strict disposable E2E auth preserved |
| POC Compose, dotenv/token directory, browser credential scripts and stress seed/runtime scripts | Excluded; port-3001 POC preserved; no real secrets copied |
| POC Playwright/fixture and feature tests | Ported into main runner; production OAuth/storage expectations rewritten for PostgreSQL; direct/Group delivery regressions retained |
| POC-only README/runtime/remove instructions | Replaced by production architecture, rollout and validation documents |
| POC tsconfig/next-env/Docker ignore alterations | Excluded; current main build configuration retained |

The pre-edit plan was to preserve validated workflows, merge overlapping files individually, consolidate forward migrations, implement PostgreSQL encrypted shared-mailbox credentials and production environment boundaries, document Google Cloud/DigitalOcean rollout, then run full regression. No material credential-model ambiguity remained after inspecting Calendar's user-bound data model.

## Changed-file inventory

The 71 current candidates below exclude ignored operational evidence, dependency/build caches and generated test output. No staging, commit or deployment has occurred.

```text
 M .env.example
 M app/app/accounts/[id]/page.tsx
 M app/app/globals.css
 M app/app/support/cases/[id]/page.tsx
 M app/app/support/cases/actions.ts
 M app/app/support/cases/new/page.tsx
 M app/app/support/cases/page.tsx
 M app/components/support-attachments.tsx
 M app/components/support-case-form.tsx
 M app/components/support-case-timeline.tsx
 M app/components/work-form.tsx
 M app/docs/deployment.md
 M app/docs/support-cases.md
 M app/e2e/helpers.ts
 M app/e2e/seed.mjs
 M app/e2e/support-attachments.spec.ts
 M app/lib/authorization.ts
 M app/lib/related-support-cases.ts
 M app/lib/support-attachments.ts
 M app/lib/support-case-display.ts
 M app/lib/support-case-timeline.ts
 M app/lib/support-cases.ts
 M app/package-lock.json
 M app/package.json
 M app/playwright.config.ts
 M app/prisma/schema.prisma
 M app/prisma/tests/integrity.sql
 M app/scripts/test-migrations.py
 M app/tests/support-case-form-state.test.mjs
 M app/tests/support-integration.test.mjs
 M app/tests/work.test.mjs
 M compose.yml
?? app/app/api/support-gmail/callback/route.ts
?? app/app/support/cases/[id]/email-attachments/actions.ts
?? app/app/support/cases/[id]/email-attachments/form.tsx
?? app/app/support/cases/[id]/email-attachments/page.tsx
?? app/app/support/inbox/actions.ts
?? app/app/support/inbox/disclosure.tsx
?? app/app/support/inbox/local-fetch-time.tsx
?? app/app/support/inbox/message-actions.tsx
?? app/app/support/inbox/page.tsx
?? app/app/support/inbox/preview/page.tsx
?? app/components/account-support-emails.tsx
?? app/components/email-file-selection.tsx
?? app/components/expanding-textarea.tsx
?? app/docs/support-email-port-review.md
?? app/docs/support-email-rollout.md
?? app/docs/support-email-validation.md
?? app/docs/support-email.md
?? app/e2e/support-email-identity.spec.ts
?? app/e2e/support-email-recovery.spec.ts
?? app/e2e/support-email.spec.ts
?? app/e2e/support-textareas.spec.ts
?? app/lib/support-email-file-import.ts
?? app/lib/support-email-source.ts
?? app/lib/support-email.ts
?? app/lib/support-gmail-config.ts
?? app/lib/support-gmail-connection.ts
?? app/lib/support-gmail-crypto.ts
?? app/lib/support-gmail-files.ts
?? app/lib/support-gmail.ts
?? app/lib/support-inbox-display.ts
?? app/prisma/migrations/20261013230000_support_email_production/migration.sql
?? app/scripts/verify-support-gmail-persistence.mjs
?? app/tests/support-email-files.test.mjs
?? app/tests/support-email-identity.test.mjs
?? app/tests/support-email-intake.test.mjs
?? app/tests/support-email.test.mjs
?? app/tests/support-gmail-auth.test.mjs
?? app/tests/support-gmail-test-helpers.mjs
?? app/tests/support-inbox-display.test.mjs
```
