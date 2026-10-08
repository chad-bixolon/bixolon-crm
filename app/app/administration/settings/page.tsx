import { NAV_CATEGORIES } from '../../../lib/navigation-categories';
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
  const editors=await prisma.user.findMany({where:{id:{in:[...new Set(audit.map(row=>row.changedById).filter((id):id is number=>id!==null))]}},select:{id:true,firstName:true,lastName:true}});
  const editorName=(id:number|null)=>{const user=editors.find(item=>item.id===id);return user?`${user.firstName} ${user.lastName}`:'System';};
  return <Content><PageHeader eyebrow={NAV_CATEGORIES.administration} title="System Settings" description="Configure reporting and follow-up thresholds. Changes to the Trade Show follow-up setting do not alter existing Tasks." action={<Link className="btn-secondary" href="/administration">Administration</Link>}/><section className="panel max-w-3xl px-5 py-2">{Object.entries(settingDefinitions).map(([key, definition]) => <div key={key}><SettingForm settingKey={key} label={definition.label} description={'description' in definition ? definition.description : undefined} value={values[key as SettingKey]} min={definition.min} max={definition.max}/>{audit.find(row => row.key === key) && <p className="pb-3 text-xs text-slate-500">Last changed by {editorName(audit.find(row => row.key === key)?.changedById ?? null)} at {audit.find(row => row.key === key)?.changedAt.toISOString()}</p>}</div>)}</section></Content>;
}
