# Products & Pricing import

Administration → Imports → Products & Pricing accepts UTF-8 CSV or one selected XLSX worksheet. The downloadable header is:

```csv
model,part_number,description,standard_price,msrp_price,reseller_price,distributor_price,currency,price_unit,active,category,catalog_source
```

`model` and `part_number` are required on every row. `description` is SKU-specific. Each price tier is a nonnegative decimal with at most two fractional digits and ten whole digits. `currency` is a valid ISO 4217 code and is required when any tier price is supplied. `price_unit` is `EACH`, `CASE`, `BOX`, or `ROLL`. `active` accepts true, false, yes, no, 1, or 0. Blank optional fields preserve existing data. There is one row per normalized part number per import; import a different currency for the same SKU in a later file. Existing prices in other currencies and tiers remain intact. No conversion is performed. Customer prices are outside this import.

`category` classifies the Product/model using an active Product Category code managed in Administration. The initial codes are `POS`, `LABEL`, `MOBILE`, `LASER`, `RIBBON`, `ACCESSORIES`, `PAPER`, and `WARRANTY`; Admins can add, rename, reorder, deactivate, and reactivate values. Unknown or inactive codes are import errors. `catalog_source` identifies the list supplying the SKU: `PRICE_LIST`, `PE_LIST`, or `SPECIAL_SKU_LIST`. Both columns are optional for existing template files and existing database rows. A blank value preserves an existing classification or leaves a new row unclassified. For PE List and Special SKU List template uploads, select the matching Catalog Source once in the upload form or set `catalog_source` on each row. A conflicting selection and row value is rejected; no unsupported workbook layout or description is used to guess provenance.

## Mapping the BIXOLON 2026 workbook

The source workbook at `reference-data/BIXOLON_Price_List.xlsx` has ten populated tabs. Select one tab per preview and confirmation; the Cover tab is change history and cannot be imported. No data is written while browsing or previewing. The adapter keeps the original worksheet row numbers in the preview.

| Worksheet | Product/model and SKU | Standard/base | MSRP | Reseller | Distributor | Currency; unit |
| --- | --- | --- | --- | --- | --- | --- |
| POS, Mobile printers | `MODEL NAME` for both; `DESCRIPTION` | `STANDARD` | `MSRP` | — | — | Admin-entered; EACH |
| Label printers | `MODEL NAME` for both; `DESCRIPTION` | — | `MSRP` | `Reseller price` → `Price` | `Distributor price` → `Price` | Admin-entered; EACH |
| Laser printers | `MODEL NAME` for both; `DESCRIPTION` | — | `MSRP` | `Reseller price` → `Price` | `Distributor price` → `Price` | Admin-entered; EACH |
| TT ribbon (2) | `Ribbon` model; `Part Number` SKU; `Description` | — | `MSRP Per Case` | — | `Price per Case, Disty` | Row `Currency`; CASE |
| Mobile Printer Accessories | `Part Code` for both; `Part Spec` | — | `MSRP` | — | `Disti Cost` | Admin-entered; EACH |
| Warranty Options | `SERVICE SKU` for both; `DESCRIPTION` | — | `MSRP` | — | `Distributor price` | Admin-entered; EACH |
| Linerless paper | `Model`, or SKU when blank; `New Part number from Japan (box)` SKU | — | `MSRP (USD)/box` | — | `Disty (USD)/box` | USD; BOX, except one ROLL row |

Every supported worksheet sets `catalog_source=PRICE_LIST`. For printer rows, explicit model-family rules take precedence: `XM7-…` → `MOBILE` and `SPP-…` → `MOBILE` (including SPP-L and SPP-R variants). Matching is case-insensitive on the model family token before the hyphen, never on descriptions. These rules are maintained in `printerCategoryByFamily` in `app/lib/product-workbook.ts`; accessory, warranty, ribbon, and paper rows retain their worksheet categories. In the current workbook, this assigns the 19 XM7 and 8 SPP-L variants on Label printers to MOBILE. Reimporting through preview and confirmation corrects existing Products while retaining one primary category and setting SKU source to PRICE_LIST. No other family exceptions are assumed. The worksheet supplies the fallback Product category: POS printers → `POS`, Mobile printers → `MOBILE`, Label printers → `LABEL`, Laser printers → `LASER`, TT ribbon (2) → `RIBBON`, Mobile Printer Accessories → `ACCESSORIES`, Warranty Options → `WARRANTY`, and Linerless paper → `PAPER`. The repository currently contains no PE List or Special SKU List workbook mapping; those lists can be imported through the explicit template columns.

The pending `20260918120000_product_classification` migration inserts these initial categories once. Later Admin edits are not overwritten by imports or by a recurring seed job. Products with no category keep a null `categoryId`; inactive categories remain linked to existing Products and can be reactivated.

The printer sheets do not have a separate base model or part-number column. The complete `MODEL NAME` is used for both fields; the importer does not guess that different variants share a base Product. The accessories and warranty tabs likewise provide a sellable code but no separate model. This preserves their distinct SKUs. The linerless sheet's old part-number column and its later container-quantity table are not imported as current priced SKUs.

`STANDARD` is the primary base price only where the workbook supplies it. All other listed amounts remain in their named tiers; no MSRP, reseller, or distributor amount is promoted into STANDARD. Sheets without STANDARD create a SKU with an empty base tier and a preview warning. Excel's computed numeric values may contain floating-point tails; each amount is rounded to two decimal places before validation. The workbook does not identify a currency on most tabs, so those tabs default to USD; an Admin can change the worksheet currency before preview. Explicit row currencies take precedence. `active` is absent and therefore preserves existing status or defaults new SKUs to active.

The Mobile printers sheet repeats `SPP-R200IIIiK` on rows 5 and 7. The earlier Bluetooth 3.0 row is excluded, and the later Bluetooth 4.1 + BLE row supplies the single active SKU, description, STANDARD, and MSRP. Its worksheet line remains 7 in the preview. The `replaced SPP-R200IIIplusiK` annotation is used to identify the current row but does not create a legacy alias or active SKU; the schema has no alias relation. If the expected later row is absent, mapping fails rather than importing the obsolete row. Only `TT ribbon  (2)` is supported; the older `TT ribbon ` tab is rejected. The Cover sheet and unsupported layouts fail with a clear error.

Part numbers match after trimming, collapsing whitespace, and uppercasing. A unique database key enforces that rule for imported and manually created SKUs. Existing Products are matched by normalized model name only when the match is unique. An exact SKU match identifies its Product; a conflicting model mapping is an error. Renaming a model shared by multiple existing SKUs requires manual review. Duplicate part numbers, including conflicting duplicate model names, are errors. New SKUs without a STANDARD/base price receive a warning. The preview shows before and after values for every tier and separate Product, SKU, and price classifications. Only an Administrator can confirm. Confirmation replans inside one serializable transaction and refuses a changed preview.

The existing `Product.sku` remains the legacy primary SKU for opportunity display and older workflows. Every legacy Product is backfilled to `ProductSku`. `OpportunityProduct.productId` and its estimated unit price remain unchanged. `ProductPrice` stores one current amount per SKU, currency, and tier; `ProductSku.priceUnit` states what each amount buys. There are no effective dates or price history. Price history and Import History are deferred until their audit and retention requirements are defined. This import does not infer OEM or private-label status from a custom SKU.

## Exact Prisma schema diff

```diff
 model Product {
   opportunities OpportunityProduct[]
+  skus          ProductSku[]
 }

+model ProductSku {
+  id                   Int                    @id @default(autoincrement())
+  productId            Int
+  product              Product                @relation(fields: [productId], references: [id], onDelete: Restrict)
+  partNumber           String
+  normalizedPartNumber String                 @unique
+  description          String?
+  priceUnit            ProductPriceUnit       @default(EACH)
+  active               Boolean                @default(true)
+  prices               ProductPrice[]
+  createdAt            DateTime               @default(now())
+  updatedAt            DateTime               @updatedAt
+  @@index([productId])
+}

+enum ProductPriceUnit {
+  EACH
+  CASE
+  BOX
+  ROLL
+}

+enum ProductPriceTier {
+  STANDARD
+  MSRP
+  RESELLER
+  DISTRIBUTOR
+}

+model ProductPrice {
+  id           Int        @id @default(autoincrement())
+  skuId        Int
+  sku          ProductSku @relation(fields: [skuId], references: [id], onDelete: Restrict)
+  tier         ProductPriceTier
+  currencyCode String     @db.VarChar(3)
+  amount       Decimal    @db.Decimal(12, 2)
+  createdAt    DateTime   @default(now())
+  updatedAt    DateTime   @updatedAt
+  @@unique([skuId, currencyCode, tier])
+}
```

## Exact forward-only migration SQL

The complete SQL is in [`migration.sql`](../prisma/migrations/20260917130000_product_catalog/migration.sql). It creates the SKU and current-price tables, rejects pre-existing normalized SKU collisions, and backfills one SKU for every existing Product. It does not alter or delete any Product or Opportunity data. It has **not** been deployed.
