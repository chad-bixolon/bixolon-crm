-- Account customer pricing was added after the original three-source CHECK.
-- Replace the constraint without changing any OpportunityProduct rows.
ALTER TABLE "OpportunityProduct"
  DROP CONSTRAINT "OpportunityProduct_price_provenance_check";

ALTER TABLE "OpportunityProduct"
  ADD CONSTRAINT "OpportunityProduct_price_provenance_check" CHECK (
    (
      "priceSource" IN ('MANUAL', 'CATALOG', 'PRICE_EXCEPTION')
      AND "odmCustomerPriceId" IS NULL AND "odmCustomerAccountId" IS NULL
      AND "odmCustomerBasePrice" IS NULL AND "odmCustomerTariffPercent" IS NULL
      AND "odmCustomerTariffAmount" IS NULL AND "odmCustomerFinalUnitPrice" IS NULL
      AND "odmCustomerCurrencyCode" IS NULL AND "odmCustomerEffectiveDate" IS NULL
      AND (
        ("priceSource" = 'MANUAL' AND "catalogPriceTier" IS NULL AND "priceExceptionLineId" IS NULL
          AND "priceExceptionCode" IS NULL AND "priceExceptionUnitPrice" IS NULL
          AND "priceExceptionCurrencyCode" IS NULL AND "priceExceptionSourceQty" IS NULL)
        OR
        ("priceSource" = 'CATALOG' AND "catalogPriceTier" IS NOT NULL AND "priceExceptionLineId" IS NULL
          AND "priceExceptionCode" IS NULL AND "priceExceptionUnitPrice" IS NULL
          AND "priceExceptionCurrencyCode" IS NULL AND "priceExceptionSourceQty" IS NULL)
        OR
        ("priceSource" = 'PRICE_EXCEPTION' AND "catalogPriceTier" IS NULL
          AND "priceExceptionLineId" IS NOT NULL AND "priceExceptionUnitPrice" IS NOT NULL
          AND "priceExceptionCurrencyCode" IS NOT NULL)
      )
    )
    OR
    (
      "priceSource" = 'ODM_CUSTOMER' AND "catalogPriceTier" IS NULL
      AND "priceExceptionLineId" IS NULL AND "priceExceptionCode" IS NULL
      AND "priceExceptionUnitPrice" IS NULL AND "priceExceptionCurrencyCode" IS NULL
      AND "priceExceptionSourceQty" IS NULL
      AND "odmCustomerPriceId" IS NOT NULL AND "odmCustomerAccountId" IS NOT NULL
      AND "odmCustomerBasePrice" IS NOT NULL AND "odmCustomerTariffPercent" IS NOT NULL
      AND "odmCustomerTariffAmount" IS NOT NULL AND "odmCustomerFinalUnitPrice" IS NOT NULL
      AND "odmCustomerCurrencyCode" IS NOT NULL
      AND "odmCustomerBasePrice" >= 0 AND "odmCustomerTariffPercent" >= 0
      AND "odmCustomerTariffAmount" >= 0
      AND "odmCustomerFinalUnitPrice" = "odmCustomerBasePrice" + "odmCustomerTariffAmount"
      AND "unitPrice" = "odmCustomerFinalUnitPrice"
    )
  );
