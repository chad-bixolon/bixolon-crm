export const routes: Record<string, string[]> = {
  Dashboard: ['/'],
  CRM: ['/accounts', '/accounts/new', '/contacts', '/contacts/new'],
  Sales: ['/opportunities', '/opportunities/new', '/pipeline', '/sales-plan', '/tasks', '/tasks/new', '/activities/new', '/calendar-matches', '/demos'],
  Programs: ['/projects', '/projects/new'],
  Marketing: ['/trade-shows', '/trade-shows/new', '/trade-shows/import-mappings', '/marketing/campaigns', '/marketing/campaigns/new', '/marketing/audiences', '/marketing/audiences/new', '/marketing/lead-sources'],
  Catalog: ['/products', '/products/new', '/price-exceptions', '/price-exceptions/lookup'],
  Reports: ['/reports', '/reports/new', '/reports/forecast', '/reports/forecast-movement', '/reports/pipeline-view', '/reports/engagement', '/reports/trade-shows', '/reports/lead-sources', '/reports/marketing-attribution', '/reports/demo-inventory', '/reports/sales-plan', '/reports/sales-plan-sku', '/reports/price-exceptions-expiring', '/reports/support-cases'],
  Support: ['/support/cases', '/support/cases/new'],
  Administration: ['/administration', '/administration/users', '/administration/users/new', '/administration/competitors', '/administration/sales-stages', '/administration/support-case-categories', '/administration/settings', '/administration/labels', '/administration/history', '/administration/dashboard-views', '/administration/sales-targets', '/administration/price-exceptions', '/administration/imports', '/administration/lookups/industries'],
  Personal: ['/my-integrations', '/notifications', '/my-day'],
};
