import { optional, type Errors } from "./crm-validation";

export const addressFields = [
  ["addressLine1", "Address line 1", 200],
  ["addressLine2", "Address line 2", 200],
  ["city", "City", 100],
  ["stateProvince", "State / Province", 100],
  ["postalCode", "Postal code", 30],
  ["country", "Country", 100],
] as const;

export type Address = { [K in (typeof addressFields)[number][0]]: string | null };

export function hasAddress(address: Address): boolean {
  return addressFields.some(([key]) => !!address[key]?.trim());
}

export function sourceAddressDiffersFromAccount(source: Address, account: Address | null): boolean {
  return hasAddress(source) && (!account || addressFields.some(([key]) => !!source[key]?.trim() && source[key]?.trim().toLowerCase() !== account[key]?.trim().toLowerCase()));
}

export function usesAccountAddress(contact: Address & { accountId: number | null; useAccountAddress?: boolean | null }): boolean {
  return contact.accountId !== null && (contact.useAccountAddress ?? !hasAddress(contact));
}

export function effectiveContactAddress<T extends Address>(contact: T & { accountId: number | null; useAccountAddress?: boolean | null; account?: Address | null }): Address {
  const source = usesAccountAddress(contact) && contact.account ? contact.account : contact;
  return Object.fromEntries(addressFields.map(([key]) => [key, source[key]])) as Address;
}

export function parseAddress(form: FormData, errors: Errors): Address {
  return Object.fromEntries(addressFields.map(([key, , limit]) => [key, optional(form, key, limit, errors)])) as Address;
}
