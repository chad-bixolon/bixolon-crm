-- Synthetic migration-harness fixture. Production-style Account price snapshots.
INSERT INTO "ProductSku" (id,"productId","partNumber","normalizedPartNumber","catalogSource","updatedAt")
VALUES (6000,100,'FIXTURE-ACCOUNT-PRICE','FIXTURE-ACCOUNT-PRICE','PRICE_LIST',now());
INSERT INTO "ProductSkuOdmCustomer" ("skuId","accountId","updatedAt")
VALUES (6000,100,now()), (6000,101,now());
INSERT INTO "ProductSkuOdmCustomerPrice" (id,"skuId","accountId","currencyCode","customerPrice",
  "tariffPercent","tariffAmount","finalUnitPrice","sourceType","updatedAt")
VALUES
  (7000,6000,100,'USD',425.70,0,0,425.70,'MANUAL',now()),
  (7001,6000,101,'USD',400.00,10,40.00,440.00,'MANUAL',now());

INSERT INTO "OpportunityProduct" (id,"opportunityId","productId","skuId",quantity,"unitPrice",
  "priceSource","odmCustomerPriceId","odmCustomerAccountId","odmCustomerBasePrice",
  "odmCustomerTariffPercent","odmCustomerTariffAmount","odmCustomerFinalUnitPrice",
  "odmCustomerCurrencyCode","updatedAt")
VALUES
  (6000,100,100,6000,1,425.70,'ODM_CUSTOMER',7000,100,425.70,0,0,425.70,'USD',now()),
  (6001,100,100,6000,1,440.00,'ODM_CUSTOMER',7001,101,400.00,10,40.00,440.00,'USD',now());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "OpportunityProduct" WHERE id=6000 AND "priceSource"='ODM_CUSTOMER'
      AND "odmCustomerPriceId"=7000 AND "odmCustomerAccountId"=100
      AND "unitPrice"=425.70 AND "odmCustomerBasePrice"=425.70
      AND "odmCustomerTariffPercent"=0 AND "odmCustomerTariffAmount"=0
      AND "odmCustomerFinalUnitPrice"=425.70 AND "odmCustomerCurrencyCode"='USD'
      AND "priceExceptionLineId" IS NULL)
    OR NOT EXISTS (SELECT 1 FROM "OpportunityProduct" WHERE id=6001
      AND "odmCustomerTariffPercent"=10 AND "odmCustomerTariffAmount"=40
      AND "odmCustomerFinalUnitPrice"=440.00) THEN
    RAISE EXCEPTION 'Account price fixture lost its production-style snapshot';
  END IF;
END $$;
