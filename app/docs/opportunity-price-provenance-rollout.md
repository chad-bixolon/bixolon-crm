# Opportunity price provenance rollout

The local Compose database is not production. Once an app image containing the audit script is available, run it from the deployed DigitalOcean App Platform console. The script reads the pending migration's exact CHECK expression and evaluates every existing `OpportunityProduct` row. It requires `NODE_ENV=production`, the exact DigitalOcean host `bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com`, the `bixolon_crm` database, and a PostgreSQL read-only session. Its output contains counts, violating row IDs, and field names only. Exit 0 means every existing row and the production-style zero-tariff shape pass; exit 2 means a violation; exit 1 means the preflight could not complete. Do not apply the migration after a nonzero result.

```sh
node /app/scripts/operations/audit-opportunity-price-provenance.mjs
```

The command requires a new image containing this script. It cannot audit production from an older deployed image, and local Compose results cannot establish production compatibility. No image deployment or migration is part of preparing this script.

The migration contains only `DROP CONSTRAINT` and `ADD CONSTRAINT` for `OpportunityProduct_price_provenance_check`. It has no row updates, deletes, inserts, other table changes, or pricing snapshot changes. On a later authorized rollout, apply once from a controlled production one-off job using the runtime image and its configured `DATABASE_URL`, then check status:

```sh
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/prisma migrate status
```

For the Compose deployment, the corresponding commands are:

```sh
docker compose exec -T app ./node_modules/.bin/prisma migrate deploy
docker compose exec -T app ./node_modules/.bin/prisma migrate status
```

After the migration, check the health endpoint:

```sh
curl --fail --silent --show-error "$APP_URL/api/health"
```

Then use a test Opportunity with a participating Account and eligible SKU to perform these production UI saves in order:

1. Select **Manual price**, enter a unit price, and save. Reopen the line and verify Manual and the entered price.
2. Select **Customer Pricing** for an Account with a configured customer price, and save. Reopen the line and verify the Account, base customer price, tariff, final unit price, and currency snapshot.
3. Select an eligible **Price Exception** for the SKU and Opportunity currency with a matching participating Account and satisfied MOQ, and save. Reopen the line and verify the Price Exception code, approved price, and MOQ snapshot.

The existing Opportunity UI and Prisma schema already support these selections. The pending constraint migration is the only database change required for these paths.
