/** Source values that explicitly mean no party was supplied. Keep the raw value for audit. */
export function isAbsentPriceExceptionParty(value: string | null | undefined): boolean {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized === '' || normalized === 'NA' || normalized === 'N/A';
}

export function displayPriceExceptionParty(value: string | null | undefined): string {
  return isAbsentPriceExceptionParty(value) ? '—' : value!;
}
