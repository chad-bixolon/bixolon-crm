import type { PrismaClient } from "@prisma/client";

export const defaultLabels = {
  ACCOUNT: "Account", CONTACT: "Contact", OPPORTUNITY: "Opportunity", PROJECT: "Project",
  TASK: "Task", ACTIVITY: "Activity", NOTE: "Note", END_USER: "End User",
  DISTRIBUTOR: "Distributor", VAR: "VAR / Reseller", ISV: "ISV", OEM: "OEM",
  PARTNER: "Service Partner", MEDIA_PARTNER: "Media Partner", STRATEGIC_ACCOUNT: "Strategic Account",
} as const;
export type LabelKey = keyof typeof defaultLabels;
export type LabelMap = Record<LabelKey, string>;
export function isLabelKey(value: string): value is LabelKey { return Object.hasOwn(defaultLabels, value); }
export function resolveLabel(key: LabelKey, overrides: Partial<LabelMap> = {}) { return overrides[key]?.trim() || defaultLabels[key]; }
export function labelMap(rows: { key: string; displayLabel: string }[]): LabelMap {
  const map = { ...defaultLabels } as LabelMap;
  for (const row of rows) if (isLabelKey(row.key)) map[row.key] = resolveLabel(row.key, { [row.key]: row.displayLabel });
  return map;
}
export async function getLabels(client: PrismaClient) { return labelMap(await client.terminologyLabel.findMany()); }
export function parseLabel(raw: string) {
  const value = raw.trim();
  if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Enter a label of 1–80 printable characters.");
  return value;
}
export async function saveLabel(client: PrismaClient, key: string, raw: string, actorId: number) {
  if (!isLabelKey(key)) throw new Error("Unknown label key.");
  const displayLabel = parseLabel(raw);
  await client.terminologyLabel.upsert({ where: { key }, create: { key, displayLabel, changedById: actorId }, update: { displayLabel, changedById: actorId, changedAt: new Date() } });
}
export async function restoreLabel(client: PrismaClient, key: string, actorId: number) {
  if (!isLabelKey(key)) throw new Error("Unknown label key.");
  await saveLabel(client, key, defaultLabels[key], actorId);
}

export const settingDefinitions = {
  STALE_ACCOUNT_WARNING_DAYS: { label: "Stale account warning (days)", defaultValue: 90, min: 1, max: 3650 },
  ACTIVITY_LOOKBACK_DAYS: { label: "Default activity lookback (days)", defaultValue: 30, min: 1, max: 365 },
} as const;
export type SettingKey = keyof typeof settingDefinitions;
export function isSettingKey(value: string): value is SettingKey { return Object.hasOwn(settingDefinitions, value); }
export function parseSetting(key: string, raw: string) {
  if (!isSettingKey(key)) throw new Error("Unknown setting key.");
  const definition = settingDefinitions[key];
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < definition.min || value > definition.max) throw new Error(`Enter ${definition.min}–${definition.max} days.`);
  return value;
}
export async function getSettings(client: PrismaClient) {
  const rows = await client.systemSetting.findMany();
  return Object.fromEntries(Object.entries(settingDefinitions).map(([key, definition]) => [key, rows.find(row => row.key === key)?.value ?? definition.defaultValue])) as Record<SettingKey, number>;
}
