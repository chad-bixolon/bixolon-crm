import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { requirePermission } from "@/lib/current-user";
const sections = [
  ["Imports", "/administration/imports", "Preview and confirm Accounts & Contacts CSV imports."],
  ["Users", "/administration/users", "Manage access and record owners."],
  ["Industries", "/administration/lookups/industries", "Manage account industry choices."],
  ["Territories", "/administration/lookups/territories", "Manage account territory choices."],
  ["Activity Types", "/administration/lookups/activity-types", "Manage activity choices and order."],
  ["Sales Stages", "/administration/sales-stages", "Manage stage names and properties."],
  ["Labels & Terminology", "/administration/labels", "Edit business-facing display labels."],
  ["System Settings", "/administration/settings", "Set safe reporting and warning defaults."],
] as const;
export default async function AdministrationPage() {
  await requirePermission("users.manage");
  return <Content><PageHeader eyebrow="CRM" title="Administration" description="Configure CRM users, choices, labels, and safe defaults."/><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{sections.map(([title, href, description]) => <Link className="panel block p-6 hover:border-orange-300 hover:bg-orange-50" href={href} key={href}><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p><span className="mt-4 inline-block text-sm font-semibold text-orange-800">Manage →</span></Link>)}</div></Content>;
}
