import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { requirePermission } from "@/lib/current-user";
const sections = [
  ["Imports", "/administration/imports", "Preview and confirm CRM, Product, and finalized Price Exception imports."],
  ["PE Cleanup", "/administration/price-exceptions", "Review and correct imported Price Exceptions, account mappings, owners, statuses, and other data issues."],
  ["Users", "/administration/users", "Manage access and record owners."],
  ["Industries", "/administration/lookups/industries", "Manage account industry choices."],
  ["Territories", "/administration/lookups/territories", "Manage account territory choices."],
  ["Product Categories", "/administration/lookups/product-categories", "Manage Product category choices and order."],
  ["Activity Types", "/administration/lookups/activity-types", "Manage activity choices and order."],
  ["Competitors", "/administration/competitors", "Manage competitor options available on Opportunities."],
  ["Sales Stages", "/administration/sales-stages", "Manage stage names and properties."],
  ["Sales Targets", "/administration/sales-targets", "Set quarterly targets by sales rep and currency."],
  ["Labels & Terminology", "/administration/labels", "Edit business-facing display labels."],
  ["System Settings", "/administration/settings", "Set safe reporting and warning defaults."],
  ["Dashboard Views", "/administration/dashboard-views", "Configure the default Dashboard for each role."],
] as const;
export default async function AdministrationPage() {
  await requirePermission("users.manage");
  return <Content><PageHeader eyebrow="CRM" title="Administration" description="Configure CRM users, choices, labels, and safe defaults."/><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{sections.map(([title, href, description]) => <Link className="panel block p-6 hover:border-orange-300 hover:bg-orange-50" href={href} key={href}><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p><span className="mt-4 inline-block text-sm font-semibold text-orange-800">Manage →</span></Link>)}</div></Content>;
}
