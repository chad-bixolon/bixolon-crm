# Approved foundation deployment verification

Migration `20260916020000_crm_foundation` was successfully applied to the existing `bixolon_crm` database after explicit approval. No reset, truncate, database recreation, existing-row deletion, or additional CRM feature development was performed.

## Backup

- Location: `/opt/bixolon-crm/backups/bixolon_crm_before_foundation_20260916T020615Z.dump`
- Size: **32,993 bytes** (approximately 32.2 KiB).
- Format: PostgreSQL custom archive, produced by the PostgreSQL 17 container's `pg_dump`.
- Archive SHA-256: `14b23762badccb84b6c667d34ad0599356ec39c298745f285bfefac317a4fce4`.
- `pg_dump` completed with exit 0. `pg_restore --list` and full archive decoding with `pg_restore --file=/dev/null` both completed with exit 0. No restore SQL was executed against the CRM database.
- Directory permissions: 0700; archive permissions: 0600. The backup and protected fingerprint manifests are excluded from Git by `backups/`.
- The logical archive omits ownership/ACL commands and does not include cluster-wide role definitions.

## Deployment

Before deployment, Prisma status reported exactly one pending migration: `20260916020000_crm_foundation`. Both migration file checksums matched the reviewed values.

Command used:

```sh
docker compose exec -T app ./node_modules/.bin/prisma migrate deploy
```

Result: all migrations successfully applied. Final status: **Database schema is up to date**; no pending migrations.

| Migration | State | SHA-256 |
|---|---|---|
| 20260916005259_initial_crm | Applied | 33f9a5f4ece57a83789738d3289f3d30917af01d750ef13d63c3badece658b29 |
| 20260916020000_crm_foundation | Applied | ad95ceb257d0ecec4c99b3254e439d9ac12eecbc8a6bf5b501c8cd5abe849ecf |

Prisma Client was regenerated in the application container and on the host, both at exactly 6.19.3. Only the application container was restarted to reload the generated client; PostgreSQL was not restarted or recreated.

## Live verification

- Fingerprints of every original column in the original ten CRM tables match their predeployment values; original record counts are unchanged.
- The 61 integrity assertions passed against the migrated database. The live wrapper uses collision-checked negative synthetic IDs, explicitly assigns every fixture ID, scopes assertions to those fixtures and ends in ROLLBACK. Existing records are never test mutation targets. This suite consumed no sequence values.
- The actual account creation/list service passed against the migrated database within a rolled-back Prisma transaction. Category/role inserts and account defaults were checked; no account, role or category test records remain.
- Post-migration fingerprints of all 18 CRM tables match after the tests, including the newly inserted role/lookup records.
- Prisma schema comparison: **No difference detected**.
- Unvalidated database constraints: **0**.
- Host lint and TypeScript: **passed**, exit 0.
- Application-container lint and TypeScript: **passed**, exit 0.
- `/accounts`: **HTTP 200** after application restart.
- `/accounts/new`: **HTTP 200**, with the expected form and Server Action.
- Create-flow verification deliberately did not submit a persistent browser POST: HTTP form availability and the actual service/database path were tested without leaving a test record.
- `git diff --check`: passed.

## Final CRM row counts

| Table | Rows |
|---|---:|
| Account | 1 |
| AccountBusinessRole | 1 |
| Activity | 0 |
| ActivityType | 4 |
| Contact | 0 |
| Currency | 1 |
| ExternalIdentity | 0 |
| Industry | 1 |
| Note | 0 |
| Opportunity | 0 |
| OpportunityAccount | 0 |
| OpportunityAccountRole | 0 |
| OpportunityProduct | 0 |
| Product | 0 |
| SalesStage | 0 |
| Task | 0 |
| Territory | 1 |
| User | 0 |

Total: 9 rows across 18 CRM tables. `_prisma_migrations` has 2 successful rows and is not included in that CRM total.

## Warnings and scope

- The rolled-back create-account service check consumed one Account sequence value. This is normal PostgreSQL sequence behavior; no test row remains and no sequence was reset.
- Shell commands emitted the pre-existing locale warning; it did not affect migration or verification results.
- The prior dependency installation reported three high-severity npm audit advisories. No dependency upgrades or forced fixes were made in this deployment, and no new dependency audit was run.
- The application still uses the existing Next.js development-server Docker workflow. No production hosting, authentication, integration or further CRM feature work was undertaken.
- There were no unexpected migration or integrity-test failures.

## Git status

No files were staged or committed. This status includes the earlier approved foundation work and the operational verification/reporting files added for deployment. Backup contents are not tracked.

```text
 M .gitignore
 M app/.dockerignore
 M app/Dockerfile
 M app/app/accounts/actions.ts
 M app/app/accounts/page.tsx
 M app/app/layout.tsx
 M app/package-lock.json
 M app/package.json
 M app/prisma/schema.prisma
?? app/docs/deployment-verification.md
?? app/docs/foundation-migration-review.md
?? app/docs/validation-results.md
?? app/lib/accounts.ts
?? app/prisma/migrations/20260916005259_initial_crm/migration.sql
?? app/prisma/migrations/20260916020000_crm_foundation/migration.sql
?? app/prisma/migrations/migration_lock.toml
?? app/prisma/tests/account-compatibility.mjs
?? app/prisma/tests/client-smoke.mjs
?? app/prisma/tests/integrity.sql
?? app/prisma/tests/legacy-fixture.sql
?? app/prisma/tests/verify-preservation.sql
?? app/scripts/operations/backup-database.py
?? app/scripts/operations/data-fingerprints.py
?? app/scripts/operations/verify-create-account.mjs
?? app/scripts/operations/verify-live-integrity.py
?? app/scripts/prisma-generate.mjs
?? app/scripts/test-migrations.py
```
