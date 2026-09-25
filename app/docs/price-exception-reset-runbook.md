# Production Price Exception reset procedure

This procedure is **prepared only**. Do not run it until the business has authorized deletion, a verified backup exists, and the dry-run reports zero `OpportunityProductLinkedToPeLine`. The script contains no path that alters Opportunity products or any other non-PE business record.

## Relationship and deletion review

Only two physical tables are PE-owned and cleared: `PriceExceptionLine`, then `PriceException`. Archived PE rows and all source metadata in those tables are included. No tables are truncated and sequences are not reset.

| Foreign key | Delete behavior when its parent is deleted | Reset consequence |
| --- | --- | --- |
| `PriceExceptionLine.priceExceptionId → PriceException.id` | RESTRICT | Delete lines before headers. |
| `OpportunityProduct.priceExceptionLineId → PriceExceptionLine.id` | RESTRICT | Any linked Opportunity product blocks the reset. |
| `PriceException.distributorAccountId`, `varAccountId`, `endUserAccountId → Account.id` | RESTRICT | Deleting PE headers does not delete Accounts. |
| `PriceException.createdById`, `updatedById → User.id` | RESTRICT | Deleting PE headers does not delete Users. |
| `PriceException.assignedSalesRepUserId → User.id` | SET NULL | This applies when a User is deleted, not when a PE is deleted. Users are preserved. |
| `PriceExceptionLine.productSkuId → ProductSku.id` | RESTRICT | Deleting PE lines does not delete SKUs. |

There is no PE-owned CASCADE path. `OpportunityProduct` is the only non-PE table with a foreign key **to** a PE table. Its `priceSource='PRICE_EXCEPTION'` check requires a non-null `priceExceptionLineId` together with the copied PE unit price and currency. The estimated unit price and copied `priceExceptionCode`, `priceExceptionUnitPrice`, `priceExceptionCurrencyCode`, and `priceExceptionSourceQty` are historical Opportunity pricing evidence. Clearing the link would violate the check; changing source or clearing snapshots would rewrite history. The reset therefore stops when even one Opportunity product references a PE line. A separate, reviewed schema and data preservation design would be required before resetting such a database; this runbook does not authorize that change.

Accounts, Contacts, Projects, Opportunities, OpportunityProducts, Products, ProductSkus, Users, ReportDefinitions, and all CRM configuration remain in place. PE usage reports are saved report definitions, not PE-owned tables; report results may change after a successful reset because their PE source rows are removed.

## Backup prerequisite and checklist

1. Schedule an approved maintenance window. Stop PE imports, PE edits, and Opportunity pricing changes before the final dry-run and apply.
2. From the production repository root, create a protected custom-format backup:

   ```sh
   python3 app/scripts/operations/backup-database.py --label pe_reset
   ```

3. Confirm the backup command succeeded, its manifest reports `toc_verified`, `full_archive_decode_verified`, and a SHA-256 checksum, and the dump and manifest are held in the protected `backups/` directory. Verify a restore to an isolated database before apply. Keep the dump and manifest outside the reset transaction for recovery.
4. Run the migration checksum check and record the current migration state:

   ```sh
   python3 app/scripts/operations/check-migration-checksums.py
   ```

5. In the DigitalOcean App Platform production console, query and record the PostgreSQL system identifier using the read-only command below. The value comes from `pg_control_system()` on the connected server; it is never derived from the hostname. Compare it with the separately maintained production cluster inventory. If the cluster has been rebuilt, review and update that inventory before apply. The command prints only the system identifier and does not print the URL or credentials.
6. Run the dry-run. Record the before counts, affected-table list, foreign-key graph, and protected-table counts. Apply is forbidden if `blocked` is true or `OpportunityProductLinkedToPeLine` is nonzero. Confirm the PE counts match the approved deletion scope.

## Commands

Run these commands inside the **DigitalOcean App Platform production app console**. The host value below is the reviewed production managed PostgreSQL host; the script accepts an explicitly supplied host and checks it against `DATABASE_URL` exactly. The app runtime supplies `NODE_ENV=production` and `DATABASE_URL`.

```sh
EXPECTED_DB_HOST=bixolon-crm-db-do-user-44410788-0.e.db.ondigitalocean.com
node scripts/operations/reset-price-exceptions.mjs --expect-host="$EXPECTED_DB_HOST" --show-system-id
```

Record the returned decimal identifier in the protected change record, compare it with the trusted cluster inventory, and set `EXPECTED_SYSTEM_ID` to that reviewed value. Then run the dry-run:

```sh
EXPECTED_SYSTEM_ID=REPLACE_WITH_REVIEWED_SERVER_SYSTEM_IDENTIFIER
node scripts/operations/reset-price-exceptions.mjs --expect-host="$EXPECTED_DB_HOST" --expect-system-id="$EXPECTED_SYSTEM_ID"
```

Only after all prerequisites and the final dry-run have passed, apply with:

```sh
node scripts/operations/reset-price-exceptions.mjs --expect-host="$EXPECTED_DB_HOST" --expect-system-id="$EXPECTED_SYSTEM_ID" --apply --confirm=DELETE_ALL_PRICE_EXCEPTIONS
```

The system ID lookup and dry-run use a connection configured with PostgreSQL `default_transaction_read_only=on`. All three commands require the production environment, a PostgreSQL `DATABASE_URL` whose hostname matches `--expect-host`, `bixolon_crm` in the URL, and `current_database() = 'bixolon_crm'`. Dry-run and apply additionally require the connected server's system identifier to equal `--expect-system-id`.

Apply locks `PriceException`, `PriceExceptionLine`, and `OpportunityProduct` against concurrent writes; rechecks identity, constraints, triggers, counts, and Opportunity links inside a serializable transaction; deletes PE lines before PE headers; verifies zero PE rows and unchanged protected-table and Opportunity snapshot counts; then commits. Any failure rolls the transaction back. Unexpected foreign keys or custom triggers also stop the reset. The command does not delete Opportunity products to make the reset succeed.

After a successful apply, run the dry-run again and retain the before/after output and backup manifest with the change record. The dry-run should show zero rows in both PE tables. Confirm the application and Opportunity pricing pages remain healthy before reopening writes or starting the Rosa import. If apply refuses because Opportunity products reference PE lines, **stop**; do not bypass the guard or clear those references manually.
