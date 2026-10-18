import { cache } from 'react';
import { prisma } from './prisma';
import { getCurrencyConfiguration, getReportingCurrencies } from './currency-configuration';

// Request-local cache: administration changes are reflected on the next request.
export const companyCurrency = cache(() => getCurrencyConfiguration(prisma));
export const reportingCurrencies = cache(() => getReportingCurrencies(prisma));
