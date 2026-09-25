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

5. Obtain `BIXOLON_PRODUCTION_SYSTEM_ID` from the **previously recorded production cluster inventory**, independently of the database connection being tested. The script also requires `NODE_ENV=production`, the Compose host `db`, database name `bixolon_crm`, and an exact match to this PostgreSQL system identifier. It prints no database URL or credentials. If the production cluster has been rebuilt, review and update the trusted inventory first.
6. Run the dry-run. Record the before counts, affected-table list, foreign-key graph, and protected-table counts. Apply is forbidden if `blocked` is true or `OpportunityProductLinkedToPeLine` is nonzero. Confirm the PE counts match the approved deletion scope.

## Commands

From the production repository root, after placing the trusted cluster identifier in the shell environment:

```sh
docker compose exec -T -e NODE_ENV=production -e BIXOLON_PRODUCTION_SYSTEM_ID="$BIXOLON_PRODUCTION_SYSTEM_ID" app node scripts/operations/reset-price-exceptions.mjs
```

Only after all prerequisites and the final dry-run have passed, the apply command is:

```sh
docker compose exec -T -e NODE_ENV=production -e BIXOLON_PRODUCTION_SYSTEM_ID="$BIXOLON_PRODUCTION_SYSTEM_ID" app node scripts/operations/reset-price-exceptions.mjs --apply --confirm=DELETE_ALL_PRICE_EXCEPTIONS
```

Apply locks `PriceException`, `PriceExceptionLine`, and `OpportunityProduct` against concurrent writes; rechecks identity, constraints, triggers, counts, and Opportunity links inside a serializable transaction; deletes PE lines before PE headers; verifies zero PE rows and unchanged protected-table and Opportunity snapshot counts; then commits. Any failure rolls the transaction back. Unexpected foreign keys or custom triggers also stop the reset. The command does not delete Opportunity products to make the reset succeed.

After a successful apply, run the dry-run again and retain the before/after output and backup manifest with the change record. The dry-run should show zero rows in both PE tables. Confirm the application and Opportunity pricing pages remain healthy before reopening writes or starting the Rosa import. If apply refuses because Opportunity products reference PE lines, **stop**; do not bypass the guard or clear those references manually.
