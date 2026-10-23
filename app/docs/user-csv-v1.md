# Admin User CSV Import/Export v1

Administration → Users now offers Import users (true Admin only) and Export users (Admin and delegated Sales Managers). The previous delegated policy authorized individual management; bulk writes remain conservative. No migration, new dependencies, credential changes, production writes, deployment, or directory synchronization.

## CSV contract

UTF-8 CSV, optionally BOM, quoted commas/newlines and escaped quotes. Headers are case insensitive and trimmed. Supported columns: First Name, Last Name, Email, Role, Active, Timezone. First four headers are required. Names/email/role are required on every row. Current eight canonical roles or their friendly labels are accepted, case insensitively. Active accepts only true/false/yes/no, case insensitively. New users require explicit Active and IANA Timezone. Blank/omitted Active and Timezone preserve existing values. Existing timezone validator supports UTC and Asia/Seoul. No scheduler/business-date changes.

Limits: 500,000 UTF-8 bytes, 500 data rows, 320 characters per column, 100 per name, and the existing timezone validator's 100-character bound. Unknown/duplicate headers, malformed CSV, invalid text, malformed roles/status/timezones, duplicate file emails, normalized existing-email conflicts, and archived matches block confirmation. Blank records are ignored. Row numbers are original physical CSV starting lines, including multiline quoted fields.

Email is trimmed/lowercased for matching all users, including archived users, and for new users. Existing stored addresses are preserved exactly. No merging, reactivation of archived users, identity transfer, or email-address renaming. A different address creates a separate authorization record; use the individual User form to rename an email.

User Administration Access is not importable. The existing value is preserved. First remove it through the individual form before deactivating a delegated user or changing that user's role away from Sales Manager.

## Review and apply

Upload → parse/validate → row preview → explicit checkbox and confirmation → server revalidation → atomic apply → counts and per-row results. Actions are Create, Update, Unchanged, Error. Preview displays name/email, current/proposed role/status, validation messages, Admin grants/removals, deactivation and role transition warnings. All role changes call out assignment eligibility, including Sales → Executive, Sales/Manager → Read Only, and Support → Support Manager.

`userChangeImpact` is the same active-work service used by individual edits: Accounts, Opportunities, Projects, Sales/Support Tasks, unresolved Cases, Trade Show assignments, PE follow-up, outstanding Demos, Sales Plans and targets. Historical attribution remains unchanged; work is not reassigned automatically.

No unresolved row or file errors may apply. `AUTH_SECRET` signs an actor-bound 15-minute digest covering CSV contents, user snapshots, errors and impact counts. No uploaded contents are persisted. Apply rechecks persisted actor, every row, target rules, impacts, and the batch's final active unarchived true-Admin population. It acquires advisory lock 72341001 and user row locks inside a Serializable transaction. Replacement Admins apply before removals, preserving the shared per-user guard. Concurrent failures roll back all changes and history; ask for a new preview instead of silently retrying. An unchanged-only replay makes no writes; changed batches invalidate their previous digest.

`saveUserInTransaction` is the shared lifecycle writer; callers must acquire the established lock, validate/whitelist fields, and recheck persisted authority. Individual edits still use `saveUser`. History uses existing AdminMaintenanceEvent actor/target/time and before/after events. Name-only changes now record Name changed for both paths; role/status/email/timezone/delegation events remain shared. Creation records User created. No competing audit model or raw CSV maintenance event.

## Export

Exports precisely the current User Administration visibility filter: Not archived (includes inactive), Archived, or All. Button and filename explicitly label the scope. Columns: User ID, First Name, Last Name, Email, Role, Active, Archived, Timezone, User Administration Access, Google sign-in status (Linked / Not linked), Created At, Updated At. UTC ISO timestamps. UTF-8 BOM and quoted CSV cells; formula-leading text is apostrophe-prefixed, including whitespace-prefixed formulas. Private no-store response. Never exports issuer, subject, tokens, passwords or other credentials.

Export is a report, not a round-trip import template: remove read-only export columns before importing and review spreadsheet-safe text prefixes. On-screen row results are implemented; downloadable result/error reports are deferred. Google account provisioning, identity linkage/reset, passwords, XLSX, SCIM, LDAP, automatic sync, new roles, arbitrary permissions, trusted-domain and multi-domain changes are excluded.

## Maintainer validation

Node 22.23.4 and Prisma 6.19.3 retained. Unit coverage in tests/user-csv.test.mjs; browser and actual database rollback coverage in e2e/user-csv.spec.ts at 1440, 1024, 820, 768, and 390 pixels. Existing lifecycle/authorization suites also run. See completion evidence for command results.

## Changed files

- `app/administration/users/page.tsx`: labeled import and filtered export entry points.
- `app/administration/users/import/page.tsx`, `actions.ts`: authorized upload/review/confirmation server workflow.
- `app/administration/users/actions.ts`: clear individual-form message for delegated-access eligibility.
- `app/administration/users/export/route.ts`: authorized, private CSV download.
- `components/user-csv-import.tsx`: guidance, responsive preview, confirmation and row results.
- `lib/user-csv.ts`: limits, normalization, validation, signed review, batch safety, atomic apply, safe export.
- `lib/import-csv.ts`: reuse existing CSV parser with configurable required headers; existing callers retain their defaults.
- `lib/users.ts`, `lib/user-lifecycle.ts`: shared transaction writer and durable name-change history.
- `lib/authorization.ts`: centralized import/export boundaries.
- `lib/help/topics.ts`: User Administration Help and Admin Help.
- `docs/authentication.md`, `docs/authorization-policy.md`, `docs/user-csv-v1.md`: authentication, policy and maintainer documentation.
- `tests/user-csv.test.mjs`, `tests/user-lifecycle.test.mjs`, `tests/user-admin.test.mjs`, `e2e/user-csv.spec.ts`, `e2e/user-lifecycle.spec.ts`: negative/functional coverage and responsive database-backed browser checks.

## Validation evidence

- Node 22.23.4; Prisma 6.19.3. No dependency changes.
- Lint and typecheck passed.
- Complete unit/regression suite: 1,547 passed, 1 existing fixture-dependent test skipped, 0 failures (1,548 total). Includes User Administration, lifecycle, authorization and CSV parser/export tests.
- Browser: all 7 CSV tests passed, including successful preview/confirm/apply/export at 1440, 1024, 820, 768 and 390 px, unauthorized routes, invalid input and actual database transaction rollback. Existing lifecycle and authorization browser suites contributed 16 additional passing tests.
- The first browser run found newline normalization changing signed review text; canonical line endings fixed it and the regression test now passes. Initial sandbox failures in subprocess tests were rerun outside the sandbox; no failing tests remain.
- Production Docker build passed, image `saleshub-user-csv-validation:local`. Existing Dockerfile keeps Node 22.23.4. Image was built locally and not deployed.
- Evidence logs are retained locally in `reports/user-csv-v1/`.
- No migrations. No commits, pushes, DigitalOcean changes or production data changes.
- Final production Webpack build passed with the browser-confirmed canonical line-ending fix included. Generated Next.js TypeScript reference changes were restored after validation.
- `git diff --check` passed.
- Pre-commit review: preserved existing email values on normalized CSV matches and moved delegated-access eligibility validation into the shared User policy. Focused User/CSV tests, typecheck, lint and affected browser suites were rerun.
