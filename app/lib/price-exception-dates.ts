import { businessToday } from './business-date';
export { businessToday } from './business-date';

export function isPriceExceptionExpired(expirationDate: Date | null, now = new Date()) {
  return expirationDate !== null && expirationDate < businessToday(now);
}
