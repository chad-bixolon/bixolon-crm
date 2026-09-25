# Archive behavior for pilot-to-live cutover

Normal lists, operational reports, dashboard metrics, audience membership and exports, and create/edit pickers use the live relationship filters in `lib/operational-where.ts`. An archived or inactive Account, or a Project linked to one, makes its related Opportunity, Task, and Activity ineligible for operational calculations. Archived Trade Shows do not supply leads to live Trade Show reports. This is query filtering; no child records are deleted or automatically archived.

Explicit archived/all record views retain saved relationships and history. An archived Trade Show detail page intentionally retains its lead history and event-level counts; live Trade Show reports and dashboards exclude that event. The Price Exception detail view retains its imported source fields and lines, including records linked to archived Accounts. Price Exception Usage reports use **live Opportunities** but intentionally retain the Price Exception code, approved unit price, MOQ, and other snapshots stored on each Opportunity product line even when the source Price Exception is later archived. Opportunity detail pages likewise retain historical pricing context. Archived Documents are available through the archived Documents section after normal parent authorization; their ordinary direct download URL does not sign a download.

Restoring a Price Exception sets its status to ACTIVE or EXPIRED based on its expiration date because the schema does not store the pre-archive status. Restoring a Document requires its parent to be writable; restore the parent first if it is archived. Saved Reports and Activities can be restored without changing their saved content.

Trade Show Lead archival remains tied to the parent Trade Show. Independent lead archival would require a separate schema migration only if a future policy calls for hiding individual leads while keeping their Trade Show live. No migration is required for this cutover behavior.

## Files changed for this implementation

- `app/app/accounts/[id]/page.tsx`
- `app/app/activities/[id]/edit/page.tsx`
- `app/app/activities/actions.ts`
- `app/app/api/documents/[id]/download/route.ts`
- `app/app/contacts/[id]/edit/page.tsx`
- `app/app/contacts/new/page.tsx`
- `app/app/contacts/page.tsx`
- `app/app/marketing/audiences/[id]/export/route.ts`
- `app/app/marketing/audiences/actions.ts`
- `app/app/page.tsx`
- `app/app/pipeline/page.tsx`
- `app/app/price-exceptions/[id]/actions.ts`
- `app/app/price-exceptions/[id]/layout.tsx`
- `app/app/price-exceptions/[id]/page.tsx`
- `app/app/price-exceptions/page.tsx`
- `app/app/products/odm-search/route.ts`
- `app/app/products/page.tsx`
- `app/app/projects/[id]/page.tsx`
- `app/app/projects/page.tsx`
- `app/app/reports/actions.ts`
- `app/app/reports/engagement/page.tsx`
- `app/app/reports/forecast/page.tsx`
- `app/app/reports/new/channel-partner-builder.tsx`
- `app/app/reports/new/page.tsx`
- `app/app/reports/new/price-exception-usage-builder.tsx`
- `app/app/reports/new/product-performance-builder.tsx`
- `app/app/reports/new/project-initiative-builder.tsx`
- `app/app/reports/page.tsx`
- `app/components/document-controls.tsx`
- `app/components/documents-section.tsx`
- `app/components/related-work.tsx`
- `app/lib/accounts.ts`
- `app/lib/contacts.ts`
- `app/lib/dashboard.ts`
- `app/lib/documents.ts`
- `app/lib/forecast.ts`
- `app/lib/marketing-audiences.ts`
- `app/lib/odm-skus.ts`
- `app/lib/opportunities.ts`
- `app/lib/opportunity-price-exceptions.ts`
- `app/lib/price-exception-resolution.ts`
- `app/lib/price-exceptions.ts`
- `app/lib/products.ts`
- `app/lib/reporting.ts`
- `app/lib/saved-reports.ts`
- `app/lib/trade-show-contact-resolution.ts`
- `app/lib/trade-show-import.ts`
- `app/lib/work-options.ts`
- `app/lib/work.ts`
- `app/tests/accounts.test.mjs`
- `app/tests/documents.test.mjs`
- `app/tests/odm-skus.test.mjs`
- `app/tests/opportunity-price-exceptions.test.mjs`
- `app/tests/price-exceptions.test.mjs`
- `app/tests/product-creation.test.mjs`
- `app/tests/product-import.test.mjs`
- `app/tests/reporting.test.mjs`
- `app/tests/trade-show-reporting.test.mjs`
- `app/tests/work.test.mjs`
- `app/app/api/documents/[id]/restore/route.ts`
- `app/docs/archive-cutover-policy.md`
- `app/lib/operational-where.ts`
- `app/tests/archive-controls.test.mjs`
- `app/tests/archive-cutover.test.mjs`
