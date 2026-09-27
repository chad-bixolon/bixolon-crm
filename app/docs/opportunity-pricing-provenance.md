# Opportunity Product price provenance

`OpportunityProduct.priceSource` has four database values. The UI calls `ODM_CUSTOMER` **Account customer price**. `unitPrice` is the Opportunity unit price; the other amount columns are historical snapshots. A line update replaces provenance for the chosen source, while an unchanged customer price or Price Exception selection retains its original snapshot.

| Source | Required fields | Null fields | Optional fields | Provenance relationship |
| --- | --- | --- | --- | --- |
| `MANUAL` | `unitPrice` | `catalogPriceTier`, every Price Exception field, every Account price field | None | None |
| `CATALOG` | `unitPrice`, `catalogPriceTier` | Every Price Exception field, every Account price field | None | Matching SKU/currency/tier price verified at save; no line FK |
| `PRICE_EXCEPTION` | `unitPrice`, `priceExceptionLineId`, `priceExceptionUnitPrice`, `priceExceptionCurrencyCode` | `catalogPriceTier`, every Account price field | `priceExceptionCode`, `priceExceptionSourceQty` | `priceExceptionLineId` FK to Price Exception line |
| `ODM_CUSTOMER` | `unitPrice`, `odmCustomerPriceId`, `odmCustomerAccountId`, `odmCustomerBasePrice`, `odmCustomerTariffPercent`, `odmCustomerTariffAmount`, `odmCustomerFinalUnitPrice`, `odmCustomerCurrencyCode` | `catalogPriceTier`, every Price Exception field | `odmCustomerEffectiveDate` | `odmCustomerPriceId` FK to Account customer price revision; Account ID saved |

For `ODM_CUSTOMER`, the base price and tariff values are nonnegative; the final price equals base plus tariff amount, and `unitPrice` equals the final price. Zero tariff uses populated zero values. The `odmCustomerPriceId` foreign key points to a customer price revision, which itself has an Account/SKU association. The save path also verifies that the selected revision belongs to the line SKU and chosen Account, uses the Opportunity currency, and is available for selection. A SQL `CHECK` cannot compare columns in the line with columns of the referenced revision.

The `PRICE_EXCEPTION` foreign key similarly retains the selected Price Exception line. Code and source quantity can be absent in historical data, so the check leaves them optional. The save path applies current selection and MOQ rules while preserving an unchanged historical selection. `CATALOG` availability is checked by the save path.

The original `20260920220000_opportunity_product_price_exception` migration created a CHECK with only Manual, Catalog, and Price Exception branches. `20260922143000_odm_customer_pricing` added `ODM_CUSTOMER` and its columns without updating that CHECK. `20260927180000_opportunity_product_account_price_provenance` replaces it, validates existing rows as PostgreSQL adds the constraint, and performs no data updates.
