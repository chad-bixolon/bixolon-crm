export type CurrencyDefinition = { code: string; name: string; active: boolean; isDefault: boolean };
export function currencyConfiguration(currencies: CurrencyDefinition[]) {
  const activeCurrencies = currencies.filter(currency => currency.active);
  const defaultCurrency = activeCurrencies.find(currency => currency.isDefault)?.code;
  if (!defaultCurrency) throw new Error('Configure an active default currency.');
  return { currencies, activeCurrencies, defaultCurrency, multiCurrencyEnabled: activeCurrencies.length > 1 };
}
export function canRetainCurrency(currency: { active: boolean } | null, requested: string, existing?: string) {
  return !!currency && (currency.active || requested === existing);
}
export function showCurrencyControl(config: Pick<CurrencyConfiguration, 'multiCurrencyEnabled'>, codes: readonly string[] = []) {
  return config.multiCurrencyEnabled || new Set(codes.filter(Boolean)).size > 1;
}


export type CurrencyConfiguration = ReturnType<typeof currencyConfiguration>;
