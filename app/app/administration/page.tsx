import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { requirePermission } from "@/lib/current-user";

const groups = [
  { title: "Data & Imports", tools: [
    ["Imports", "/administration/imports", "Preview and confirm CRM, Product, and Price Exception imports."],
    ["PE Cleanup", "/administration/price-exceptions", "Review imported Price Exceptions and correct data issues."],
  ] },
  { title: "Users & Access", tools: [
    ["Users", "/administration/users", "Manage user access and record owners."],
    ["Dashboard Views", "/administration/dashboard-views", "Configure the default Dashboard for each role."],
  ] },
  { title: "Sales Configuration", tools: [
    ["Sales Stages", "/administration/sales-stages", "Manage stage names and properties."],
    ["Sales Targets", "/administration/sales-targets", "Set quarterly targets by sales rep and currency."],
    ["Competitors", "/administration/competitors", "Manage competitor options available on Opportunities."],
    ["Territories", "/administration/lookups/territories", "Manage account territory choices."],
  ] },
  { title: "CRM Configuration", tools: [
    ["Industries", "/administration/lookups/industries", "Manage account industry choices."],
    ["Activity Types", "/administration/lookups/activity-types", "Manage activity choices and order."],
    ["Labels & Terminology", "/administration/labels", "Edit business-facing display labels."],
  ] },
  { title: "Product Configuration", tools: [
    ["Product Categories", "/administration/lookups/product-categories", "Manage Product category choices and order."],
  ] },
  { title: "System & History", tools: [
    ["System Settings", "/administration/settings", "Set safe reporting and warning defaults."],
    ["Opportunity & Forecast History", "/administration/history", "Capture weekly forecast snapshots and archive eligible history."],
  ] },
] as const;

export default async function AdministrationPage() {
  await requirePermission("users.manage");
  return <Content>
    <PageHeader eyebrow="CRM" title="Administration" description="Manage users, CRM configuration, sales settings, and system tools."/>
    <div className="space-y-7">{groups.map((group, index) => <section aria-labelledby={`admin-group-${index}`} key={group.title}>
      <h2 className="mb-3 text-lg font-semibold text-slate-900" id={`admin-group-${index}`}>{group.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{group.tools.map(([title, href, description]) => <Link className="panel flex flex-col p-4 transition-colors hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={href} key={href}>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
        <span className="mt-auto pt-3 text-sm font-semibold text-orange-800">Manage →</span>
      </Link>)}</div>
    </section>)}</div>
  </Content>;
}
