# Foundation validation results

These are the predeployment test results. The subsequently approved live deployment is recorded in [deployment verification](deployment-verification.md).

| Check | Result |
|---|---|
| Original migration checksum | Exact match with the existing database |
| Prisma CLI and Client | Both exactly 6.19.3; manifest and lockfile pinned |
| Existing locked dependency versions | No version changes |
| Prisma schema validation | Passed |
| Docker image build / npm ci / postinstall generation | Passed without CRM credentials |
| Host `npm run lint` | Passed, exit 0 |
| Host `npm run typecheck` | Passed, exit 0 |
| Docker `npm run lint` with networking disabled | Passed, exit 0 |
| Docker `npm run typecheck` with networking disabled | Passed, exit 0 |
| Empty database migration replay | Both migrations applied successfully |
| Populated legacy upgrade | Passed |
| Original row preservation | All 21 synthetic rows retained every original column value |
| SQL integrity tests | 61 assertions passed |
| Prisma Client integration | Nested roles, multiple participants, composite membership, attribution, Decimal arithmetic and archival passed |
| Existing account create/list compatibility | Passed against both baseline and revised schemas using the revised client |
| Schema parity | No difference detected for fresh and upgraded databases |
| Repeat deployment | No pending migrations; no changes reapplied |
| Invalid legacy role rollback | Passed |
| Missing estimated price rollback | Passed |
| Conflicting parent rollback | Passed |
| Invalid sales-stage rollback | Passed |
| Test cleanup | Disposable database containers and internal networks removed |
| Existing CRM account-list HTTP check | 200, read-only request |
| Existing CRM database read-only verification | One account, original migration only, no foundation table |
| `git diff --check` | Passed |

Fixtures were synthetic; no CRM data was copied into the test environment. Test database ports were not published, storage was tmpfs, and the test runner never consumed the CRM connection settings.

The restored migration SHA-256 is `33f9a5f4ece57a83789738d3289f3d30917af01d750ef13d63c3badece658b29`.
The forward migration SHA-256 is `ad95ceb257d0ecec4c99b3254e439d9ac12eecbc8a6bf5b501c8cd5abe849ecf`.
The final schema SHA-256 is `a3f446e049a1f2bd612ae88439686bca268fd8494669fe87ac6785ac1d6388f3`.

Docker image build is not a production Next.js build: the Dockerfile retains the development-server workflow. No production Next.js build was claimed or run. npm installation reported three high-severity audit advisories; no audit-driven upgrades or forced fixes were made.

## git diff --stat

This is the literal command output for tracked files; Git excludes untracked additions from this command until staged.

```text
 app/.dockerignore           |   1 +
 app/Dockerfile              |   5 +-
 app/app/accounts/actions.ts |  17 +-
 app/app/accounts/page.tsx   |  15 +-
 app/app/layout.tsx          |   2 +-
 app/package-lock.json       |  72 ++++++-
 app/package.json            |  16 +-
 app/prisma/schema.prisma    | 461 ++++++++++++++++++++++++++++++++++----------
 8 files changed, 455 insertions(+), 134 deletions(-)
```

New files are also part of the proposed change: the two migration SQL files, migration lock, account compatibility adapter, generation script, migration test runner, five fixture/test files and two review/result documents. No files have been staged or committed.

See [the migration review](foundation-migration-review.md) for exact transformations, deployment precautions and reproduction commands. Review [the schema](../prisma/schema.prisma) and [the exact forward SQL](../prisma/migrations/20260916020000_crm_foundation/migration.sql) before authorizing deployment.
