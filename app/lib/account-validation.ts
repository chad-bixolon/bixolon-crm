import { AccountBusinessRoleCode, AccountStatus } from "@prisma/client";
import { parseAddress, type Address } from "./address";
import { defaultLabels } from "./configuration";

export const roleLabels: Record<AccountBusinessRoleCode, string> = {
  END_USER: defaultLabels.END_USER, DISTRIBUTOR: defaultLabels.DISTRIBUTOR, VAR: defaultLabels.VAR, ISV: defaultLabels.ISV, OEM: defaultLabels.OEM, PARTNER: defaultLabels.PARTNER,
};
export const statuses = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type AccountFields = Address & {
  name: string; status: AccountStatus; strategicAccount: boolean; roles: AccountBusinessRoleCode[];
  industry: string | null; territory: string | null; ownerId: number | null;
  website: string | null; phone: string | null;
};
export type ValidationResult = { value?: AccountFields; errors: Record<string, string> };

export function parseAccountForm(form: FormData): ValidationResult {
  const errors: Record<string, string> = {};
  const valueOf = (key: string) => String(form.get(key) ?? "").trim();
  const optional = (key: string, limit: number) => {
    const value = valueOf(key);
    if (value.length > limit) errors[key] = `Use ${limit} characters or fewer.`;
    return value || null;
  };
  const name = valueOf("name");
  if (!name) errors.name = "Account name is required.";
  else if (name.length > 200) errors.name = "Use 200 characters or fewer.";
  const rawStatus = valueOf("status") || "ACTIVE";
  if (!statuses.includes(rawStatus as AccountStatus) || rawStatus === "ARCHIVED") errors.status = "Choose an available status.";
  const rawRoles = form.getAll("roles").map(String);
  if (rawRoles.some((role) => !Object.hasOwn(roleLabels, role))) errors.roles = "Choose valid business roles.";
  const roles = [...new Set(rawRoles)] as AccountBusinessRoleCode[];
  const owner = valueOf("ownerId");
  const ownerId = owner ? Number(owner) : null;
  if (owner && (!Number.isSafeInteger(ownerId) || Number(ownerId) <= 0)) errors.ownerId = "Choose a valid owner.";
  const website = optional("website", 500);
  if (website) {
    try { const url = new URL(website); if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw Error(); }
    catch { errors.website = "Enter a full http or https URL."; }
  }
  const phone = optional("phone", 50);
  if (phone && !/^[+()\d .-]{5,50}$/.test(phone)) errors.phone = "Enter a valid phone number.";
  const industry = optional("industry", 100);
  const territory = optional("territory", 100);
  const address = parseAddress(form, errors);
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { name, status: rawStatus as AccountStatus, strategicAccount: form.has("strategicAccount"), roles, industry, territory, ownerId, website, phone, ...address } };
}
