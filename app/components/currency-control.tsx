'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { showCurrencyControl, type CurrencyConfiguration } from '@/lib/currency-rules';

const Context = createContext<CurrencyConfiguration | null>(null);
export function CurrencyProvider({ configuration, children }: { configuration: CurrencyConfiguration; children: ReactNode }) {
  return <Context.Provider value={configuration}>{children}</Context.Provider>;
}
export function useCurrencyConfiguration() {
  const config = useContext(Context);
  if (!config) throw new Error('CurrencyProvider is required.');
  return config;
}
export function CurrencyControl({ children, value, name = 'currencyCode', historicalCodes = [] }: { children: ReactNode; value: string; name?: string; historicalCodes?: string[] }) {
  const config = useCurrencyConfiguration();
  if (showCurrencyControl(config, historicalCodes)) return children;
  return <>{value && value !== config.defaultCurrency && <span className="text-sm text-slate-600">Currency: {value}</span>}<input type="hidden" name={name} value={value}/></>;
}
export function MultiCurrencyOnly({ children }: { children: ReactNode }) {
  return useCurrencyConfiguration().multiCurrencyEnabled ? children : null;
}
