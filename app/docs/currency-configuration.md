# Currency Configuration & UX v1

SalesHub has one company currency configuration; this feature does not introduce tenancy. The existing `Currency` model supplies definitions, active status, and the new `isDefault` flag. The current deployment starts with USD active and default. The engine does not depend on company name, Account country, shipping address, or geography.

## Administration

Administration → Currency Settings requires the effective user's `users.manage` permission. Every mutation independently requires an active Admin, including during development impersonation. The screen lists Currency, Code, Status, Default, and actions to add, activate, deactivate, or set a default. Supported choices come from the runtime's ISO 4217 currency catalog and English display names; amounts retain the existing Intl currency formatting.

Configuration writes run in a transaction under a shared advisory lock. A partial unique index permits at most one default; a database check requires a default to be active. To deactivate the default, first activate another currency and set it as default. The service rejects deactivating the last active currency. There is no delete action.

Adding a currency activates it. Setting a default requires it to be active. Changing the default never modifies an Opportunity, price, target, plan, snapshot, report, or saved filter.

## Shared capability

`getCurrencyConfiguration(client)` returns `defaultCurrency`, `activeCurrencies`, `multiCurrencyEnabled`, and all definitions. `companyCurrency()` caches that read only within the current server request. The authenticated layout supplies the same configuration to client components through `CurrencyProvider`.

`CurrencyControl` hides its selector when only one currency is active and the control offers no historical alternatives. It emits a hidden form input carrying the existing state. Two active currencies automatically expose the control, regardless of their codes. Report/history controls remain available when stored inactive currencies offer a meaningful alternative. Existing inactive record currency is identified and can be retained on edit; it cannot be selected for a new record.

`getReportingCurrencies` includes active definitions and currencies found in Opportunities, Opportunity Snapshots, both forecast history systems, Sales Plans, Sales Targets, catalog prices, Price Exception lines, and Account customer pricing. Legacy codes without a definition remain readable; they do not become active entry choices.

## Defaults and compatibility

New Opportunity forms, Trade Show conversion forms, Sales Target forms, Sales Plan imports, customer pricing, missing workbook currency choices, dashboards, quarterly forecasts, movement views, and Sales Plan views use the configured default where a workflow already supplied a default. Explicit query choices and stored record currencies take precedence. A recovered draft with an unavailable currency prompts for an active selection without silently changing its prices.

URLs such as `currencyCode=USD` remain supported. Existing report configurations retain currency filters. Opportunity and Pipeline Saved Views now preserve `currencyCode` and apply it to database queries, even when their selector is hidden. Report builder hidden inputs retain saved currency filters. Export currencies remain explicit so a downloaded workbook can be understood outside SalesHub.

Inactive definitions remain stored. Existing Opportunity and Sales Target edits may retain their inactive currency. Existing Sales Plans, allocations, snapshots, pricing evidence, and history continue to display their stored currency. Inactive currencies are absent from new entry options; server validation protects Opportunity, Sales Target, customer pricing, and Sales Plan creation. Target sync may update existing inactive-currency targets but cannot create missing targets until an Admin activates that currency. Source import adapters retain their explicit source currency semantics, including the legacy workbook adapter's documented USD source assumption.

## UI audit

| Area | v1 behavior |
| --- | --- |
| Opportunities | Hide the create/edit selector and the list currency filter when there is no choice. Retain hidden query/form state. Stored inactive edit currency remains selectable. Detail visibility follows configuration rather than a USD comparison. |
| Pipeline | Hide a redundant filter; retain separate currency groups, symbols, and meaningful currency headings when data includes several currencies. |
| Pipeline Movement | Hide redundant selectors in Weekly Comparison and History & Outcomes. Remove “Each view uses one currency.” Configured active and captured historical codes remain available. |
| Quarterly Forecast | Hide the redundant selector and remove “Values are shown in one currency.” Preserve target and Opportunity currency filtering. |
| Forecast Movement | Replace free text currency entry with configured/historical choices and hide it when redundant. |
| Opportunity Snapshots | Preserve both captured endpoint currencies and separate totals. This view already had no general currency dropdown. Forwarded forecast currency remains hidden query state. |
| Forecast Snapshots | Hide a redundant currency filter; preserve separate salesperson/currency groups and captured currency changes. |
| Reports | Hide currency filters in Pipeline, Product Performance, Channel/Partner, Project Performance, Price Exception Usage, and Trade Show builders. User-selected currency columns, grouping choices, monetary code formatting, and export metadata remain available for interpreting results. |
| Dashboards | Hide the currency-only form when redundant; retain explicit currency in drilldown URLs and per-currency metrics. |
| Sales Plans | Hide redundant plan, management report, SKU rollup, and import currency controls. Retain currency on revisions, allocations, target sync, history, and Excel exports. Historical exports accept configured inactive currencies. |
| Price Exceptions | Keep approved transaction currency, source import evidence, and price/Opportunity currency matching. Lookup and detail screens had no redundant general currency selector. |
| Account/customer summaries | Account Overview currently shows engagement rather than a combined financial total. Keep transaction and customer-price currency visible where needed to identify approved terms; hide redundant customer pricing entry controls. |
| Administration | Add Currency Settings. Hide redundant Sales Target entry/filter, weekly capture, and missing-workbook-currency controls. Keep historical currency metadata. |
| Help | Explain company configuration, hidden single-currency controls, choices with multiple active currencies, and no automatic conversion. Update Pipeline Movement instructions so they do not require a currency choice in single-currency mode. |

Currency codes on historical changes, snapshot endpoints, approved prices, mixed-data results, report columns, and exports intentionally remain. Currency configuration does not erase financial evidence or alter separate-total calculations.

## No FX

There are no exchange-rate feeds, conversions, consolidated reporting currency, historical FX rates, or realized/unrealized FX calculations. Values are grouped or filtered by stored transaction currency. Unlike currencies must never be silently summed. Future consolidated totals require a separately approved conversion mechanism.

## Migration and validation

`20261018180000_currency_configuration` adds `Currency.isDefault`, seeds USD as the active default, and adds the default uniqueness and active-default constraints. It does not update historical transaction or snapshot tables and does not remove existing definitions. The existing schema-level USD Opportunity default is retained for backward compatibility; application creation workflows supply the configured company default explicitly.

Validation includes unit coverage for configuration, rendering, hidden state, Saved Views, inactive currency entry/edit rules, default protection, effective-role permissions, and impersonation. The browser currency suite checks 1440px desktop, 768px, 820px, 1024px, and 390px phone layouts across entry, reports, forecasting, dashboards, snapshots, and Administration. Feature browser runs can use an explicitly named `saleshub_e2e_*` database on the existing dedicated local test database port; production authentication remains disabled for that test provider.

Migration replay includes a pre-currency populated database with CAD Opportunities and immutable Opportunity/Forecast Snapshots. It fingerprints every preexisting table other than the configuration table, verifies preservation, and exercises database default constraints. No production migration or data change is part of this build.

## Owner decisions

No additional owner policy decision is required for v1. Default protection, inactive-history access, and separate totals follow the requested rules. Any future FX conversion or consolidated currency reporting requires a separate approved design.

## Validation results

- Node 22.23.3: full unit suite **1,353 passed, 1 existing skip, 0 failed**. Includes Saved Views, reports, forecasts, snapshots, Opportunities, permissions, impersonation, and target sync.
- Lint: passed with no warnings. Typecheck and production build (`npm run build -- --webpack`): passed. Webpack was used because this environment blocks Turbopack's temporary-port worker.
- Currency browser behavior: all five cases verified across separate runs, including one/two active currencies, default changes, inactive history, Saved Views, old USD URLs, Admin permissions, and impersonation.
- Responsive browser checks: 21 sales/report/Administration routes at **1440, 768, 820, 1024, and 390px**, with redundant currency controls absent in the USD-only fixture. Currency Settings also passed all five widths; its Add currency choice intentionally remains available. Screenshots were reviewed at phone and tablet widths and saved under `/tmp/currency-validation`.
- Existing browser regressions: **58 cases verified** across Admin, Help, Opportunity/Forecast Snapshots, Opportunities, both Pipeline Movement views, reports, and Saved Views. The broad run passed 56; two environment-related cases passed in an isolated rerun. Separate Sales Plan and both Price Exception correction cases also passed.
- Migration suite: **all tests passed**, including empty replay, populated preservation, schema parity, currency-specific transaction/history fingerprints, default uniqueness/activation checks, and repeat deployment. All migration databases were disposable.
- `git diff --check`: passed.

The test database bootstrap supports an explicit unused `E2E_DATABASE_NAME=saleshub_e2e_currency_<suffix>` name on the dedicated loopback test port. Use a fresh name for the USD-only browser fixture: the deactivation test intentionally retains CAD history afterward. No production database, DigitalOcean configuration, commit, push, or deployment was changed.

## Changed files

- `app/app/administration/currencies/actions.ts`
- `app/app/administration/currencies/page.tsx`
- `app/app/administration/forecast-snapshots/page.tsx`
- `app/app/administration/history/page.tsx`
- `app/app/administration/imports/products/workflow.tsx`
- `app/app/administration/page.tsx`
- `app/app/administration/sales-targets/page.tsx`
- `app/app/layout.tsx`
- `app/app/opportunities/[id]/edit/page.tsx`
- `app/app/opportunities/[id]/page.tsx`
- `app/app/opportunities/page.tsx`
- `app/app/page.tsx`
- `app/app/pipeline/page.tsx`
- `app/app/reports/forecast-movement/page.tsx`
- `app/app/reports/forecast-snapshots/page.tsx`
- `app/app/reports/forecast/page.tsx`
- `app/app/reports/new/channel-partner-builder.tsx`
- `app/app/reports/new/page.tsx`
- `app/app/reports/new/price-exception-usage-builder.tsx`
- `app/app/reports/new/product-performance-builder.tsx`
- `app/app/reports/new/project-initiative-builder.tsx`
- `app/app/reports/new/trade-show-builder.tsx`
- `app/app/reports/opportunity-snapshots/page.tsx`
- `app/app/reports/pipeline-movement/history/page.tsx`
- `app/app/reports/pipeline-movement/page.tsx`
- `app/app/reports/sales-plan-sku/export/route.ts`
- `app/app/reports/sales-plan-sku/page.tsx`
- `app/app/reports/sales-plan/export/route.ts`
- `app/app/reports/sales-plan/page.tsx`
- `app/app/sales-plan/import/workflow.tsx`
- `app/app/sales-plan/page.tsx`
- `app/app/trade-shows/[id]/leads/[leadId]/convert/page.tsx`
- `app/components/currency-control.tsx`
- `app/components/opportunity-form.tsx`
- `app/components/product-odm-fields.tsx`
- `app/docs/currency-configuration.md`
- `app/e2e/admin.spec.ts`
- `app/e2e/constants.mjs`
- `app/e2e/currency-configuration.spec.ts`
- `app/e2e/pipeline-movement-ui.spec.ts`
- `app/e2e/prepare.mjs`
- `app/lib/company-currency.ts`
- `app/lib/currency-configuration.ts`
- `app/lib/currency-rules.ts`
- `app/lib/e2e-auth.ts`
- `app/lib/help/topics.ts`
- `app/lib/odm-skus.ts`
- `app/lib/opportunities.ts`
- `app/lib/pipeline-movement-history-report.ts`
- `app/lib/pipeline-movement-report.ts`
- `app/lib/sales-target-sync.ts`
- `app/lib/sales-targets.ts`
- `app/lib/saved-views.ts`
- `app/next.config.ts`
- `app/prisma/migrations/20261018180000_currency_configuration/migration.sql`
- `app/prisma/schema.prisma`
- `app/scripts/test-migrations.py`
- `app/tests/administration-page.test.mjs`
- `app/tests/archive-cutover.test.mjs`
- `app/tests/assignment-eligibility.test.mjs`
- `app/tests/commercial-intelligence.test.mjs`
- `app/tests/contact-relationship-lifecycle.test.mjs`
- `app/tests/correctness-navigation.test.mjs`
- `app/tests/currency-configuration.test.mjs`
- `app/tests/e2e-auth.test.mjs`
- `app/tests/odm-skus.test.mjs`
- `app/tests/opportunity-detail-layout.test.mjs`
- `app/tests/opportunity-price-exceptions.test.mjs`
- `app/tests/opportunity-product-display.test.mjs`
- `app/tests/pipeline-movement-history.test.mjs`
- `app/tests/pipeline-movement.test.mjs`
- `app/tests/product-form-state.test.mjs`
- `app/tests/sales-plan-report-filters.test.mjs`
- `app/tests/sales-target-sync.test.mjs`
