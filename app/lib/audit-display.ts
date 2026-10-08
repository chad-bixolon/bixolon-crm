const internalIdLabels: Record<string, string> = {
  accountId: 'Account', contactId: 'Contact', userId: 'User', ownerId: 'User',
  assignedToId: 'User', productId: 'Product', productSkuId: 'Product / SKU',
  projectId: 'Project', opportunityId: 'Opportunity', supportCaseId: 'Support Case',
  priceExceptionId: 'Price Exception', replacementPriceExceptionId: 'Price Exception',
};

function internalIdLabel(key: string): string | undefined {
  if (internalIdLabels[key]) return internalIdLabels[key];
  const entity = key.match(/(Account|Contact|User|ProductSku|Product|Project|Opportunity|SupportCase|PriceException|TradeShow)Id$/)?.[1];
  return entity ? ({ ProductSku: 'Product / SKU', SupportCase: 'Support Case', PriceException: 'Price Exception', TradeShow: 'Trade Show' } as Record<string, string>)[entity] ?? entity : undefined;
}

export function auditDisplayJson(value: unknown, lookup?: (key: string, id: number) => string | undefined): string {
  return JSON.stringify(value, (key, item) => {
    if (typeof item === 'number' && internalIdLabel(key)) return lookup?.(key, item) || internalIdLabel(key);
    return item;
  }, 2);
}
