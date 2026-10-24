import { NAV_CATEGORIES } from '../../lib/navigation-categories';
import Link from "next/link";
import { Content, PageHeader } from "@/components/shell";
import { requirePermission } from "@/lib/current-user";
import { getModuleAvailability, moduleForPath } from '@/lib/module-availability';

const groups = [
  { title: "Data & Imports", tools: [
    ["Imports", "/administration/imports", "Preview and confirm CRM, Product, and Price Exception imports."],
    ["Price Exception Cleanup", "/administration/price-exceptions", "Review imported Price Exceptions and correct data issues."],
    ["Data Quality", "/administration/data-quality", "Review CRM records that may need cleanup or follow-up."],
  ] },
  { title: "Users & Access", tools: [
    ["Modules", "/administration/modules", "Choose which SalesHub modules are available in this deployment."],
    ["Company & Branding", "/administration/company-branding", "Set company and product names and upload a company logo."],
    ["Trusted Sign-In Domains", "/administration/trusted-domains", "Choose corporate Google domains allowed to sign in."],
    ["Internal Email Domains", "/administration/internal-email-domains", "Identify your own organization's email addresses in Calendar, My Day, and Support."],
    ["Ownership & Reassignment", "/administration/ownership", "Review records assigned to inactive or ineligible users and safely reassign work."],
    ["Users", "/administration/users", "Manage user access and record owners."],
    ["Dashboard Views", "/administration/dashboard-views", "Configure the default Dashboard for each role."],
  ] },
  { title: "Sales Configuration", tools: [
    ["Currency Settings", "/administration/currencies", "Manage active currencies and the company default."],
    ["Sales Stages", "/administration/sales-stages", "Manage stage names and properties."],
    ["Sales Targets", "/administration/sales-targets", "Set quarterly targets by sales rep and currency."],
    ["Outcome Reasons", "/administration/outcome-reasons", "Manage Closed Won and Closed Lost reasons."],
    ["Competitors", "/administration/competitors", "Manage competitor options available on Opportunities."],
    ["Territories", "/administration/lookups/territories", "Manage account territory choices."],
  ] },
  { title: "CRM Configuration", tools: [
    ["Support Case Categories", "/administration/support-case-categories", "Manage Support Case categories and display order."],
    ["Industries", "/administration/lookups/industries", "Manage account industry choices."],
    ["Activity Types", "/administration/lookups/activity-types", "Manage activity choices and order."],
    ["Labels & Terminology", "/administration/labels", "Edit business-facing display labels."],
  ] },
  { title: "Product Configuration", tools: [
    ["Product Categories", "/administration/lookups/product-categories", "Manage Product category choices and order."],
  ] },
  { title: "System & History", tools: [
    ["Audit History", "/administration/audit-history", "See who changed key records and compare before and after values."],
    ["Integration & Job History", "/administration/maintenance-history?view=integrations", "Review connection actions and scheduled job results."],
    ["Maintenance History", "/administration/maintenance-history", "See who performed supported maintenance actions and when."],
    ["System Health", "/administration/system-health", "Check services, connections, and scheduled jobs."],
    ["System Settings", "/administration/settings", "Set safe reporting and warning defaults."],
    ["Opportunity & Forecast History", "/administration/history", "Manage Opportunity changes and separate weekly Forecast Movement captures."],
    ["Forecast Snapshots", "/administration/forecast-snapshots", "Create quarterly forecast history from Opportunity Snapshots."],
    ["Opportunity Snapshots", "/administration/opportunity-snapshots", "Capture and compare weekly Opportunity history."],
  ] },
] as const;

export default async function AdministrationPage() {
  await requirePermission("configuration.manage");
  const availability = await getModuleAvailability();
  return <Content>
    <PageHeader eyebrow={NAV_CATEGORIES.administration} title="Administration" description="Manage users, CRM configuration, sales settings, and system tools."/>
    <div className="space-y-7">{groups.map((group, index) => { const tools = group.tools.filter(([, href]) => { const feature = moduleForPath(href); return !feature || availability.effective.has(feature); }); return tools.length ? <section aria-labelledby={`admin-group-${index}`} key={group.title}>
      <h2 className="mb-3 text-lg font-semibold text-slate-900" id={`admin-group-${index}`}>{group.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tools.map(([title, href, description]) => <Link className="panel flex flex-col p-4 transition-colors hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={href} key={href}>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
        <span className="mt-auto pt-3 text-sm font-semibold text-orange-800">Manage →</span>
      </Link>)}</div>
    </section> : null; })}</div>
  </Content>;
}
