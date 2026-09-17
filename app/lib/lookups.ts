import type { PrismaClient } from "@prisma/client";

export type LookupKind = "industries" | "territories" | "activity-types";
export function lookupKind(value: string): value is LookupKind { return value === "industries" || value === "territories" || value === "activity-types"; }
export function lookupTitle(kind: LookupKind) { return kind === "industries" ? "Industry" : kind === "territories" ? "Territory" : "Activity Type"; }

export async function listLookups(client: PrismaClient, kind: LookupKind) {
  const orderBy = [{ sortOrder: "asc" as const }, { name: "asc" as const }];
  return kind === "industries" ? client.industry.findMany({ orderBy, include: { _count: { select: { accounts: true } } } }) : kind === "territories" ? client.territory.findMany({ orderBy, include: { _count: { select: { accounts: true } } } }) : client.activityType.findMany({ orderBy, include: { _count: { select: { activities: true } } } });
}

export type LookupInput = { code: string; name: string; active: boolean; sortOrder: number };
export function parseLookup(form: FormData, editing: boolean) {
  const errors: Record<string, string> = {};
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const rawOrder = String(form.get("sortOrder") ?? "").trim();
  const sortOrder = Number(rawOrder);
  if (!code || code.length > 100) errors.code = "Code is required and must be 100 characters or fewer.";
  if (!name || name.length > 200) errors.name = "Name is required and must be 200 characters or fewer.";
  if (!/^\d+$/.test(rawOrder) || !Number.isSafeInteger(sortOrder)) errors.sortOrder = "Enter a whole number of zero or more.";
  if (editing && !code) errors.code = "Choose an existing value.";
  return { errors, value: Object.keys(errors).length ? undefined : { code, name, active: form.has("active"), sortOrder } satisfies LookupInput };
}

export async function saveLookup(client: PrismaClient, kind: LookupKind, input: LookupInput, editing: boolean) {
  if (kind === "industries") {
    if (editing) await client.industry.update({ where: { code: input.code }, data: { name: input.name, active: input.active, sortOrder: input.sortOrder } });
    else await client.industry.create({ data: input });
  } else if (kind === "territories") {
    if (editing) await client.territory.update({ where: { code: input.code }, data: { name: input.name, active: input.active, sortOrder: input.sortOrder } });
    else await client.territory.create({ data: input });
  } else {
    if (editing) await client.activityType.update({ where: { code: input.code }, data: { name: input.name, active: input.active, sortOrder: input.sortOrder } });
    else await client.activityType.create({ data: input });
  }
}
