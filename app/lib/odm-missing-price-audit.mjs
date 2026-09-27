// Read-only audit over immutable import evidence and current SKU/Account prices.
export function missingSpecialConfigurationPrices(evidence, skus, accounts) {
  const skuByPart = new Map(skus.map(sku => [sku.normalizedPartNumber, sku]));
  const accountById = new Map(accounts.map(account => [account.id, account.name]));
  const normalizeAccount = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const missing = [];
  for (const row of evidence) {
    const resolution = row.resolution ?? {};
    const source = row.source ?? {};
    const sourceMatches = accounts.filter(account => normalizeAccount(account.name) === normalizeAccount(source.customerCell));
    const accountId = Number(resolution.accountId ?? resolution.choices?.accountId ?? (sourceMatches.length === 1 ? sourceMatches[0].id : null));
    const sourcePrice = String(resolution.price ?? '');
    if (row.disposition !== 'IMPORTED' || resolution.subtype !== 'SPECIAL_CONFIGURATION' || !Number.isSafeInteger(accountId) || accountId <= 0 || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(sourcePrice)) continue;
    const sku = skuByPart.get(String(resolution.partNumber ?? '').trim().replace(/\s+/g, ' ').toUpperCase());
    if (!sku || sku.catalogSource !== 'ODM' || sku.odmSubtype !== 'SPECIAL_CONFIGURATION') continue;
    if (sku.odmCustomers?.some(link => link.accountId === accountId && !link.archivedAt && link.prices?.some(price => !price.archivedAt))) continue;
    missing.push({ sku: sku.partNumber, skuId: sku.id, account: accountById.get(accountId) ?? `Account #${accountId}`, accountId, sourcePrice, tariffPercent: resolution.tariffPercent ?? source.tariffPercent ?? null, tariffAmount: resolution.tariffAmount ?? source.tariffAmount ?? null, workbook: row.workbook, sheet: row.sheet, rowNumber: row.rowNumber, partIndex: row.partIndex, sourceKey: row.sourceKey });
  }
  return missing;
}
