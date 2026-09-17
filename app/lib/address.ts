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

export function parseAddress(form: FormData, errors: Errors): Address {
  return Object.fromEntries(addressFields.map(([key, , limit]) => [key, optional(form, key, limit, errors)])) as Address;
}
