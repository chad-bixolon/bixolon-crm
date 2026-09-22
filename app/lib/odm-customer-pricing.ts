import { Prisma } from '@prisma/client';

export type OdmPriceInput = { customerPrice: string; previousPrice?: string | null; tariffPercent?: string | null; tariffAmount?: string | null; currencyCode: string; effectiveDate?: string | null; notes?: string | null };
const Decimal = Prisma.Decimal;
const money = (raw: string, label: string) => {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label} must be a nonnegative amount with at most two decimal places.`);
  return new Decimal(raw);
};
const percent = (raw: string) => {
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,4})?$/.test(raw)) throw new Error('Tariff % must be a nonnegative percentage with at most four decimal places.');
  return new Decimal(raw);
};

/** Money rounds half up to cents. Percent is stored to four decimal places.
 * Supplied percent and amount may differ by at most one cent from rounded math.
 * The supplied amount is retained when they agree within that tolerance. */
export function calculateOdmCustomerPrice(input: OdmPriceInput) {
  const base = money(input.customerPrice.trim(), 'Customer Price');
  const previous = input.previousPrice?.trim() ? money(input.previousPrice.trim(), 'Previous Price') : null;
  const rawPercent = input.tariffPercent?.trim().replace(/%$/, '') ?? '';
  const rawAmount = input.tariffAmount?.trim() ?? '';
  let rate = rawPercent ? percent(rawPercent) : null;
  let amount = rawAmount ? money(rawAmount, 'Tariff Amount') : null;
  if (rate && amount) {
    const expected = base.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (expected.sub(amount).abs().gt('0.01')) throw new Error(`Tariff Amount disagrees with Customer Price × Tariff % (expected ${expected.toFixed(2)}).`);
  } else if (rate) amount = base.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  else if (amount) {
    if (base.isZero() && !amount.isZero()) throw new Error('Cannot infer Tariff % from a zero Customer Price.');
    rate = base.isZero() ? new Decimal(0) : amount.div(base).mul(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }
  rate ??= new Decimal(0); amount ??= new Decimal(0);
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Choose a three-letter currency code.');
  const date = input.effectiveDate?.trim() ?? '';
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date)) throw new Error('Effective Date must be a valid date.');
  if ((input.notes ?? '').length > 2000) throw new Error('Pricing Notes exceed 2000 characters.');
  const final = base.add(amount);
  if (final.gt('9999999999.99')) throw new Error('Final Unit Price exceeds the supported amount.');
  return { currencyCode, customerPrice: base.toFixed(2), previousPrice: previous?.toFixed(2) ?? null, tariffPercent: rate.toFixed(4), tariffAmount: amount.toFixed(2), finalUnitPrice: final.toFixed(2), effectiveDate: date ? new Date(`${date}T00:00:00Z`) : null, notes: input.notes?.trim() || null };
}

export type SubmittedOdmPrice = OdmPriceInput & { accountId: number };
export function parseOdmPriceForm(form: FormData): SubmittedOdmPrice[] {
  const ids = form.getAll('odmPriceAccountId').map(Number);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate ODM customer pricing entry.');
  return ids.map((accountId, index) => {
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Invalid ODM pricing Account.');
    const get = (key: string) => String(form.getAll(key)[index] ?? '').trim();
    return { accountId, customerPrice: get('odmCustomerPrice'), previousPrice: get('odmPreviousPrice'), tariffPercent: get('odmTariffPercent'), tariffAmount: get('odmTariffAmount'), currencyCode: get('odmCurrencyCode') || 'USD', effectiveDate: get('odmEffectiveDate'), notes: get('odmPricingNotes') };
  }).filter(row => row.customerPrice || row.previousPrice || row.tariffPercent || row.tariffAmount || row.effectiveDate || row.notes);
}
