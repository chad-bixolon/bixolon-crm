# Responsive UI audit

Viewport classes: phone 390×844, tablet portrait 768×1024, tablet landscape 1024×768, desktop 1440×900. The browser route inventory is the source of truth for the direct routes below. PASS means the route loaded with a visible heading, no console error, and no document-level horizontal overflow. FIXED means its layout or shared controls changed in this pass. NEEDS FOLLOW-UP means a complex operation needs deeper touch workflow review; the landing route remains reachable.

## Route classification

| Area | Route | Result |
| --- | --- | --- |
| Dashboard | `/` | FIXED |
| CRM | `/accounts` | PASS |
| CRM | `/accounts/new` | PASS |
| CRM | `/contacts` | PASS |
| CRM | `/contacts/new` | PASS |
| Sales | `/opportunities` | PASS |
| Sales | `/opportunities/new` | PASS |
| Sales | `/pipeline` | PASS |
| Sales | `/sales-plan` | PASS |
| Sales | `/tasks` | PASS |
| Sales | `/tasks/new` | PASS |
| Sales | `/activities/new` | PASS |
| Sales | `/calendar-matches` | PASS |
| Sales | `/demos` | PASS |
| Programs | `/projects` | PASS |
| Programs | `/projects/new` | PASS |
| Marketing | `/trade-shows` | PASS |
| Marketing | `/trade-shows/new` | PASS |
| Marketing | `/trade-shows/import-mappings` | NEEDS FOLLOW-UP |
| Marketing | `/marketing/campaigns` | PASS |
| Marketing | `/marketing/campaigns/new` | PASS |
| Marketing | `/marketing/audiences` | PASS |
| Marketing | `/marketing/audiences/new` | PASS |
| Marketing | `/marketing/lead-sources` | PASS |
| Catalog | `/products` | PASS |
| Catalog | `/products/new` | PASS |
| Catalog | `/price-exceptions` | PASS |
| Catalog | `/price-exceptions/lookup` | PASS |
| Reports | `/reports` | PASS |
| Reports | `/reports/new` | PASS |
| Reports | `/reports/forecast` | PASS |
| Reports | `/reports/forecast-movement` | PASS |
| Reports | `/reports/pipeline-view` | PASS |
| Reports | `/reports/engagement` | PASS |
| Reports | `/reports/trade-shows` | PASS |
| Reports | `/reports/lead-sources` | PASS |
| Reports | `/reports/marketing-attribution` | PASS |
| Reports | `/reports/demo-inventory` | PASS |
| Reports | `/reports/sales-plan` | PASS |
| Reports | `/reports/sales-plan-sku` | PASS |
| Reports | `/reports/price-exceptions-expiring` | PASS |
| Reports | `/reports/support-cases` | PASS |
| Support | `/support/cases` | FIXED |
| Support | `/support/cases/new` | FIXED |
| Administration | `/administration` | PASS |
| Administration | `/administration/users` | PASS |
| Administration | `/administration/users/new` | PASS |
| Administration | `/administration/competitors` | PASS |
| Administration | `/administration/sales-stages` | PASS |
| Administration | `/administration/support-case-categories` | PASS |
| Administration | `/administration/settings` | PASS |
| Administration | `/administration/labels` | PASS |
| Administration | `/administration/history` | PASS |
| Administration | `/administration/dashboard-views` | PASS |
| Administration | `/administration/sales-targets` | PASS |
| Administration | `/administration/price-exceptions` | PASS |
| Administration | `/administration/imports` | NEEDS FOLLOW-UP |
| Administration | `/administration/lookups/industries` | PASS |
| Personal | `/my-integrations` | PASS |
| Personal | `/notifications` | FIXED |
| Personal | `/my-day` | PASS |

## Detail and interaction coverage

- Account, Contact, Opportunity, Project, Support Case, and Price Exception record details were sampled from live list links at each viewport.
- The phone Support flow covers intake, Product/SKU selection, failed validation and value preservation, case history, attachment upload, download visibility, and removal.
- Drawer navigation, Escape and focus return, entity picker bounds and touch selection, and notification popover bounds have dedicated responsive browser tests.
- Dense CRM, pricing, and report tables retain a local horizontal scroll region. Support Cases use compact cards below 1024px so their key operational fields stay together.

## Follow-up scope

- Full import mapping and administration reconciliation interactions on a 390px phone were not exercised end to end. Their route-level layout is bounded; desktop and tablet workflows remain the priority for those dense tools.
