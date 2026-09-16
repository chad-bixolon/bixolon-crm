# CRM foundation migration review

Status: subsequently approved and applied to the existing CRM database. See [deployment verification](deployment-verification.md) for backup, live integrity checks and final results.

## Review artifacts

- Final Prisma schema: `../prisma/schema.prisma`.
- Restored initial SQL: `../prisma/migrations/20260916005259_initial_crm/migration.sql`.
- Exact forward SQL: `../prisma/migrations/20260916020000_crm_foundation/migration.sql`.
- Test runner: `../scripts/test-migrations.py`.
- Synthetic fixtures and assertions: `../prisma/tests/`.

The initial migration's SHA-256 is
`33f9a5f4ece57a83789738d3289f3d30917af01d750ef13d63c3badece658b29`,
matching the successfully applied row in the existing database. Restoring this file
requires no database changes and no `migrate resolve` on the existing database.

The forward migration's SHA-256 is
`ad95ceb257d0ecec4c99b3254e439d9ac12eecbc8a6bf5b501c8cd5abe849ecf`.
Do not edit an applied migration. Future changes require a new migration.

## Final design

- Prisma CLI and Client remain exactly 6.19.3. No previously locked dependency version changed.
- Users have ADMIN, SALES_MANAGER, SALES or READ_ONLY roles (default READ_ONLY).
- ExternalIdentity maps a user to a unique issuer/subject, with one identity per user/provider.
  GOOGLE is the only provider currently defined. There is no authentication implementation or token storage.
- Accounts have multiple controlled business roles. STRATEGIC is excluded; strategicAccount is a separate boolean, default false.
- OpportunityAccount gives each opportunity any number of participating accounts.
  OpportunityAccountRole allows multiple roles per participant. Account business roles do not imply opportunity roles.
- Account, Contact, Opportunity, Task, Activity and Note have createdById, updatedById and archivedById.
  Lookup and junction tables have timestamps but no user-attribution relationships.
  Legacy attribution remains null; no author is invented.
- Core relationships restrict deletion instead of cascading history deletion. Archiving a parent does not rewrite children.
- A primary contact must be active and unarchived; a SQL partial unique index permits only one per account.
- Task supports no parent, account only, opportunity only, or both. Activity and Note require at least one parent.
  If both IDs are present, their composite FK must reference an OpportunityAccount membership.
- Industry, Territory, ActivityType and SalesStage are controlled lookup records. Currency has a three-letter code.
- Sales stage probabilities are 0–100; sort order is nonnegative. Won implies closed;
  closed-won probability is 100 and closed-lost probability is 0. Opportunity overrides are null or 0–100.
- Opportunity currency defaults to USD. All line prices use that currency. No FX conversion or stored editable total is added.
- estimatedUnitPrice is mapped to the existing unitPrice column (Decimal(12,2)); it is required and nonnegative.
  Quantity is a positive integer. Numeric NaN is explicitly rejected.
  Value is `COALESCE(SUM(quantity * unitPrice), 0)` over unarchived lines, calculated using Decimal/numeric arithmetic.
- The schema includes indexes for ownership, stage/close-date, account participation, tasks, activity timelines and attribution.

CHECK constraints and the partial primary-contact index live in SQL because Prisma 6.19.3
cannot fully represent them. A zero Prisma schema diff alone is insufficient; the integration
suite explicitly exercises these database rules.

## Data transformations on eventual deployment

The migration contains no DROP TABLE, DROP COLUMN, TRUNCATE, DELETE or UPDATE statements
against existing records. Foreign-key constraints are replaced inside a single transaction.

1. Account.status, Task.status/priority and Opportunity.forecastCategory are cast in place
   from text to enums, preserving the exact strings. Unknown strings cause failure, not coercion.
2. New fields receive documented defaults or nulls: strategicAccount=false, User.role=READ_ONLY,
   Contact/SalesStage.active=true, Opportunity.currencyCode=USD; archival/attribution/completion fields are null.
3. Existing industry and territory strings become lookup codes/names verbatim, including case and whitespace.
   Existing Account.industry/territory column values remain unchanged and become foreign keys.
   Administrators may subsequently change display names without changing stable codes.
4. AccountBusinessRole receives one assignment for each non-null legacy accountType.
   The old accountType column and its values remain intact as deprecated compatibility data.
5. Existing opportunity/account pairs populate OpportunityAccount. Participant roles are intentionally
   left unassigned rather than guessed. The original accountId column is retained, made nullable,
   and mapped to legacyAccountId in Prisma.
6. Existing Activity.type values populate ActivityType verbatim. CALL, EMAIL, MEETING and OTHER
   are inserted if absent. USD is inserted into Currency. Existing sales stages are preserved;
   no arbitrary pipeline stages or users are seeded.
7. Existing unitPrice values and timestamps remain unchanged. A null unit price is rejected;
   the migration never substitutes zero for an unknown estimate.

The current database audit found one Account, no other CRM rows, no unsupported account type,
and only the original successful migration. No forward-schema table existed during the final read-only check.

Invalid legacy STRATEGIC roles, archived accounts without an approved archival date mapping,
conflicting parent relationships, invalid enum values, primary-contact conflicts, invalid stage
states and invalid prices/quantities abort for explicit review. No automatic data cleanup occurs.
The SQL has BEGIN/COMMIT, a 5-second lock timeout and a 60-second statement timeout.
A failed Prisma deployment may record a failure in migration metadata even when all schema changes
roll back; investigate before any explicitly approved recovery action.

## Generation and existing application compatibility

`npm ci` runs the explicit generator. `npm run dev`, `npm run build` and `npm run typecheck`
also generate the client. The generator verifies both installed versions are 6.19.3 and uses an
unreachable, nonsecret placeholder URL confined to the generation process; it never needs a live
connection. Normal migration commands still require an actual DATABASE_URL.

Docker copies the schema, config and generator before npm ci. Each environment generates its own
client; the host and Docker dependency directories are not interchangeable. Docker ignores .env
and .env.*. Typechecking does not need to rewrite Docker-owned Next.js output: the root layout
uses an explicit children type rather than the generated LayoutProps helper.

The existing account list/create flow has a temporary schema-capability adapter. It selects only
baseline columns before migration; afterward it reads authoritative business roles and participant
counts and writes new roles transactionally. The existing free-text category inputs insert lookup
records as a compatibility measure. A future authenticated admin/category-picker UI should replace
that behavior. No full UI or authentication/integration features were added.

## Reproduce validation

From the repository root:

```sh
docker build -t bixolon-crm-foundation-test:local app
python3 app/scripts/test-migrations.py
npm run lint --prefix app
npm run typecheck --prefix app
docker run --rm --network none bixolon-crm-foundation-test:local npm run lint
docker run --rm --network none bixolon-crm-foundation-test:local npm run typecheck
```

The runner never reads .env or DATABASE_URL. It creates uniquely named test resources on an
internal Docker network, uses PostgreSQL 17 with tmpfs storage and no published ports, and removes
only those resources on completion. Fixtures are synthetic. Its `migrate resolve` calls target
only the disposable test databases to simulate an existing baseline; never copy those calls to production.

The suite covers fresh replay, populated upgrade, preservation of 21 original rows, 61 SQL integrity
assertions, generated-client nested writes/Decimal arithmetic, baseline/revised account compatibility,
repeat deployment, schema parity and four rollback scenarios. Test-only DML/cleanup statements are
not deployment migration SQL.

## Deployment approval gate

This gate was completed for the reviewed foundation migration. The following remains the procedure for future migrations.

Do not run `npm run db:deploy`, `prisma migrate deploy`, `db push`, `migrate dev`, or reset commands
against the existing CRM database until the exact forward SQL has been approved. There is no migration
step in Docker startup. Before approved deployment, recheck live data and migration status and arrange
a protected database backup; do not print its contents or connection credentials. This review does not
claim that a backup has been taken.

The current Docker setup still runs the Next.js development server. Authentication, production hosting
hardening and full UI work remain outside this change. No Fishbowl, QuickBooks, DLU or Rosa integrations
were implemented.
