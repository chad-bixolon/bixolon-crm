# Rosa Price Exception CSV import

The preferred admin workflow is `/administration/imports/price-exceptions/rosa`. The legacy XLSX workflow remains available at `/administration/imports/price-exceptions` and has unchanged semantics.

| Rosa column | CRM destination |
| --- | --- |
| PE Number | `PriceException.peCode`; normalized value in `sourceKey` as `ROSA:<NUMBER>` |
| Status | `approved` maps to `ACTIVE`; exact source value in `PriceException.sourceMetadata.sourceStatus` |
| Requested At, Reviewed At | Exact strings in `PriceException.sourceMetadata`; no schema timestamp fields exist for these events |
| Requested By, Reviewed By | Exact strings in `sourceMetadata.rosaRaw`; deterministic CRM IDs in `requestedByUserId` and `reviewedByUserId` metadata |
| Customer | Distributor/OEM Account link and `distributorSourceName`; metadata records that the source label was Customer |
| VAR | VAR Account link and `varSourceName` |
| End User | End User Account link and `endUserSourceName` |
| Expiration Date | `PriceException.expirationDate` and exact source string in `rosaRaw` |
| SKU | `PriceExceptionLine.productSkuId` and exact `sourceSku` |
| Quantity | `PriceExceptionLine.sourceQuantity`, `sourceQuantityRaw`, and exact source metadata |
| Original Price | `PriceExceptionLine.sourceMetadata.originalPrice` and full raw row; no canonical original-price column exists |
| Approved Price | `PriceExceptionLine.approvedUnitPrice` and full raw row |
| Currency | `PriceExceptionLine.currencyCode` and full raw row |
| Description | `PriceException.sourceDescription` and full raw row |

`createdById` records the CRM admin who applied the import. It does not represent Rosa's requestor. The requestor becomes the assigned salesperson only if the deterministic match is an active Sales or Sales Manager user. The reviewer does not become the PE owner.

The current PE enum has no `APPROVED` member. Mapping approved to `ACTIVE` retains the exact source approval in metadata and leaves expiration as a separate date; the existing legacy workbook import is unchanged. The expiration date still controls PE pricing eligibility through existing application rules.

Rows are grouped by normalized PE Number. A group is READY when all header fields agree; harmless Description whitespace is ignored for this comparison. Each source pricing row becomes its own `PriceExceptionLine`, including repeated SKUs with different quantities or prices. Stable source line keys use a tier fingerprint and occurrence number, not a uniqueness constraint on SKU. Missing or ambiguous user, Account, or SKU matches require review. Conflicting header fields block the entire group and are listed with source line values. An existing Rosa PE is marked EXISTING / NO CHANGE only when its stored header and full tier multiset match; different tiers require review. Apply uses a serializable transaction and repeats the preview before writing. Existing PE lines and Opportunity snapshots are never updated or deleted.

From `app/`, with `DATABASE_URL` pointed at a nonproduction CRM database:

```sh
node scripts/rosa-price-exception-import.mjs preview ../reference-data/price-exceptions-2026-09-25.csv
node scripts/rosa-price-exception-import.mjs apply ../reference-data/price-exceptions-2026-09-25.csv --digest DIGEST_FROM_PREVIEW --confirm IMPORT_READY_ROWS --actor-id ADMIN_USER_ID
```

The preview command only reads the database. The apply command creates READY PE groups and all their pricing lines together; it skips all other dispositions. No schema change is required; `sourceMetadata` on the header and line preserves the complete source row and historical fields.
