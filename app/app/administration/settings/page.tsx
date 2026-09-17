import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { SettingForm } from "@/components/setting-form";
import { getSettings, settingDefinitions, type SettingKey } from "@/lib/configuration";
import { requirePermission } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  await requirePermission("users.manage");
  const values = await getSettings(prisma);
  const audit = await prisma.systemSetting.findMany();
  return <Content><PageHeader eyebrow="Administration" title="System Settings" description="Defaults for informational warnings and activity reporting. These values do not change stored records or calculations." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><section className="panel p-5">{Object.entries(settingDefinitions).map(([key, definition]) => <div key={key}><SettingForm settingKey={key} label={definition.label} value={values[key as SettingKey]} min={definition.min} max={definition.max}/>{audit.find(row => row.key === key) && <p className="mb-4 text-xs text-slate-500">Last changed by user #{audit.find(row => row.key === key)?.changedById} at {audit.find(row => row.key === key)?.changedAt.toISOString()}</p>}</div>)}</section></Content>;
}
