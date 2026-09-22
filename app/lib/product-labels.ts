import type { ProductCatalogSource, OdmCustomizationSubtype } from '@prisma/client';
export const catalogSourceLabels: Record<ProductCatalogSource, string> = { PRICE_LIST: 'Price List', PE_LIST: 'PE List', SPECIAL_SKU_LIST: 'Special SKU List', ODM: 'ODM' };
export const odmSubtypeLabels: Record<OdmCustomizationSubtype, string> = { CUSTOMER_SPECIFIC: 'Customer-Specific', SPECIAL_CONFIGURATION: 'Special Configuration', CABLE_PACKAGING_ACCESSORY: 'Cable / Packaging / Accessory', OTHER: 'Other', LEGACY_SPECIAL_SKU: 'Legacy Special SKU' };
