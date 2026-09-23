import type {
  ForecastCategory,
  OpportunityPartyRole,
  OpportunityProductPriceSource,
  Prisma,
  ProductPriceTier,
} from '@prisma/client';
import type { Actor } from './authorization';
import { canViewPriceException, type PriceExceptionVisibilityRecord } from './price-exception-visibility';

type OpportunityForForm = {
  name: string;
  description: string | null;
  competitorId: number | null;
  currentProductBeingUsed: string | null;
  customerPainPoints: string | null;
  ownerId: number | null;
  stageId: number;
  expectedCloseDate: Date | null;
  probability: number | null;
  forecastCategory: ForecastCategory | null;
  currencyCode: string;
  projects: { projectId: number }[];
  contacts: { contactId: number; isPrimary: boolean }[];
  participants: { accountId: number; roles: { role: OpportunityPartyRole }[] }[];
  products: OpportunityProductForForm[];
};

type OpportunityProductForForm = {
  id: number;
  productId: number;
  skuId: number | null;
  quantity: number;
  estimatedUnitPrice: Prisma.Decimal;
  priceSource: OpportunityProductPriceSource;
  catalogPriceTier: ProductPriceTier | null;
  priceExceptionLineId: number | null;
  priceExceptionCode: string | null;
  priceExceptionUnitPrice: Prisma.Decimal | null;
  priceExceptionCurrencyCode: string | null;
  priceExceptionSourceQty: string | null;
  odmCustomerPriceId: number | null;
  odmCustomerAccountId: number | null;
  odmCustomerBasePrice: Prisma.Decimal | null;
  odmCustomerTariffPercent: Prisma.Decimal | null;
  odmCustomerTariffAmount: Prisma.Decimal | null;
  odmCustomerFinalUnitPrice: Prisma.Decimal | null;
  priceExceptionLine: {
    priceException: PriceExceptionVisibilityRecord & {
      distributorAccountId: number | null;
      varAccountId: number | null;
      endUserAccountId: number | null;
    };
  } | null;
};

export type OpportunityFormInitial = {
  name: string;
  description: string | null;
  competitorId: number | null;
  currentProductBeingUsed: string | null;
  customerPainPoints: string | null;
  ownerId: number | null;
  projectIds: number[];
  stageId: number;
  expectedCloseDate: string | null;
  probability: number | null;
  forecastCategory: ForecastCategory | null;
  currencyCode: string;
  participants: { accountId: number; roles: OpportunityPartyRole[] }[];
  contacts: { contactId: number; isPrimary: boolean }[];
  lines: {
    id: number;
    productId: number;
    skuId: number | null;
    quantity: number;
    price: string;
    priceSource: OpportunityProductPriceSource;
    catalogPriceTier: ProductPriceTier | null;
    priceExceptionLineId: number | null;
    priceExceptionCode: string | null;
    priceExceptionUnitPrice: string | null;
    priceExceptionCurrencyCode: string | null;
    priceExceptionSourceQty: string | null;
    priceExceptionAccountIds: number[];
    odmCustomerPriceId: number | null;
    odmCustomerAccountId: number | null;
    odmCustomerBasePrice: string | null;
    odmCustomerTariffPercent: string | null;
    odmCustomerTariffAmount: string | null;
    odmCustomerFinalUnitPrice: string | null;
  }[];
};

export function serializeOpportunityForForm(opportunity: OpportunityForForm, actor: Actor): OpportunityFormInitial {
  return {
    name: opportunity.name,
    description: opportunity.description,
    competitorId: opportunity.competitorId,
    currentProductBeingUsed: opportunity.currentProductBeingUsed,
    customerPainPoints: opportunity.customerPainPoints,
    ownerId: opportunity.ownerId,
    projectIds: opportunity.projects.map(link => link.projectId),
    stageId: opportunity.stageId,
    expectedCloseDate: opportunity.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    probability: opportunity.probability,
    forecastCategory: opportunity.forecastCategory,
    currencyCode: opportunity.currencyCode,
    participants: opportunity.participants.map(participant => ({
      accountId: participant.accountId,
      roles: participant.roles.map(role => role.role),
    })),
    contacts: opportunity.contacts.map(contact => ({
      contactId: contact.contactId,
      isPrimary: contact.isPrimary,
    })),
    lines: opportunity.products.map(line => ({
      id: line.id,
      productId: line.productId,
      skuId: line.skuId,
      quantity: line.quantity,
      price: line.estimatedUnitPrice.toFixed(2),
      priceSource: line.priceSource,
      catalogPriceTier: line.catalogPriceTier,
      priceExceptionLineId: line.priceExceptionLineId,
      priceExceptionCode: line.priceExceptionCode,
      priceExceptionUnitPrice: line.priceExceptionUnitPrice?.toFixed(2) ?? null,
      priceExceptionCurrencyCode: line.priceExceptionCurrencyCode,
      priceExceptionSourceQty: line.priceExceptionSourceQty,
      priceExceptionAccountIds: line.priceExceptionLine && canViewPriceException(actor, line.priceExceptionLine.priceException)
        ? [
            line.priceExceptionLine.priceException.distributorAccountId,
            line.priceExceptionLine.priceException.varAccountId,
            line.priceExceptionLine.priceException.endUserAccountId,
          ].filter((accountId): accountId is number => accountId !== null)
        : [],
      odmCustomerPriceId: line.odmCustomerPriceId,
      odmCustomerAccountId: line.odmCustomerAccountId,
      odmCustomerBasePrice: line.odmCustomerBasePrice?.toFixed(2) ?? null,
      odmCustomerTariffPercent: line.odmCustomerTariffPercent?.toFixed(4) ?? null,
      odmCustomerTariffAmount: line.odmCustomerTariffAmount?.toFixed(2) ?? null,
      odmCustomerFinalUnitPrice: line.odmCustomerFinalUnitPrice?.toFixed(2) ?? null,
    })),
  };
}
