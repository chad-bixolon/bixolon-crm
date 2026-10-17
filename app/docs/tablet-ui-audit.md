# SalesHub tablet control consistency audit

The October 16, 2026 audit standardizes tablet search, filter, and form controls while preserving the existing phone and wide desktop layouts. The implementation changes presentation only. It uses the isolated `saleshub_e2e` database and mock Support Inbox messages; no production records or mailbox messages were changed. No push or deployment command was run.

## Findings and fixes

| Pages or controls | Rendered finding | Change |
| --- | --- | --- |
| Accounts, Contacts, Opportunities, Projects, Tasks, Support Cases, Price Exceptions, Products, Trade Shows, Campaigns, and report search bars | Tablet fields were 40px while collapsed Search and Filters buttons were 44px. Search submission occupied an additional full row. | Shared tablet control height is 44px. At 640–1023px, collapsed search and its submit button share a row with an 8px gap. |
| Projects, Pipeline, Opportunities, Contacts, Forecast, Forecast Movement, and other report filter grids | Wrapped labels, separate labels, and entity pickers used different spacing. Some field values inherited bold label text. Generic three-column grids became crowded when the sidebar appeared at 1024px. | Generic filter grids use two columns through 1279px, consistent label spacing, normal field text, and aligned controls. Helper text stays below its field. Existing compact Sales Plan and Campaign rows retain their content-sized columns where they fit. |
| Native selects across list filters, record forms, Reports, and Administration | WebKit painted native select backgrounds and arrows differently from adjacent search fields. | Tablet single selects use the shared border, radius, padding, background, and chevron. Native selection and keyboard behavior remain available; forced colors restore the native appearance. |
| EntityPicker consumers including CRM forms, Activities, Projects, report entity filters, and Support SKU selection | Selected pickers grew because the Change button had a separate minimum height plus container padding or borders. | Tablet selection containers and their embedded action use one control height. Long selected names can still expand rather than being clipped. |
| Contacts Account filter in the Unassigned state | The label disappeared, the container lost its field-sized height, and `filter-control` overrode its flex display. | The state retains its Account label and uses the shared selection container and Clear action. |
| Saved Views on all supported lists | Long names lacked a shrinkable text element inside the flex summary. Truncation could hide the disclosure indicator. | The label truncates independently, keeps its full accessible text and title, and leaves the indicator visible. |
| Opportunity Snapshot History and Forecast Snapshot History | Reset and Compare actions used different alignment and gap rules. | Both use a shared compact action class with tablet-only alignment and spacing. Their phone and desktop arrangements remain intact. |
| Support Inbox, Reports landing page, Help, and Administration list pages without mixed filter controls | No additional page-specific alignment defect was found in the sampled rendered controls. | Shared field/button sizing applies where relevant; their specialized layouts remain intact. |

## Shared responsive rules

Tablet styling covers 640–1279px, including landscape with the existing 240px sidebar. The requested checks use 768×1024, 820×1180, and 1024×768 CSS viewports. Phone controls retain their existing 44px scale below 640px; wide desktop controls retain their 40px scale at 1280px and above.

Control height, radius, padding, label spacing, and vertical alignment are standardized. Widths remain appropriate to each control: Accounts retains its compact flex layout; Sales Plan and Campaign rows retain their distinct search, owner, year, and currency widths at 1024px; Opportunity search spans the grid; report builder fields retain their container-based layout; Help search stays bounded by its existing maximum width. Textareas, multi-selects, native date pickers, checkboxes, file inputs, table scrolling, Support cards, and the navigation breakpoint keep their existing behavior.

## Coverage and screenshots

The tablet suite visits 74 routes per browser and viewport, including every route in the existing inventory and the newer Inbox, Help, ownership, data quality, audit, maintenance, and Snapshot routes. It checks rendered field heights, control bounds, page overflow, collapsed search alignment, expanded filters, Contacts advanced filters, selected/unassigned pickers, custom date submission, and long Saved View names with keyboard interaction.

Screenshots include each route, expanded filter bars, Contacts advanced and unassigned filters, custom Opportunity dates, and long Saved View names. The visual review samples the requested areas in both engines at all three widths. The [screenshot gallery and validation logs](../reports/tablet-ui-audit-2026-10-16/index.html) contain the local audit artifacts. Existing responsive tests also cover phone and desktop control scale, record details and edit forms, touch pickers, filter state, navigation, and bulk actions.

WebKit uses an iPad Safari browser profile with the requested viewport dimensions. This is Linux WebKit emulation, not a physical iPad or Apple Safari certification; [Playwright documents the distinction](https://playwright.dev/docs/browsers#webkit). Native iPad date dialogs, the software keyboard, Safari chrome, and focus zoom still need a physical-device check.

## Files changed

| File | Purpose |
| --- | --- |
| `app/globals.css` | Shared tablet control, select, filter-grid, compact-action, and Saved View styles |
| `components/entity-picker.tsx` | Shared selected-state styling hooks |
| `components/support-case-picker.tsx` | Use the same sizing hooks for selected SKUs |
| `components/contact-account-filter.tsx` | Labeled, aligned Unassigned state |
| `components/saved-view-control.tsx` | Separate truncating text and disclosure indicator |
| `app/reports/opportunity-snapshots/page.tsx` | Shared compact action class |
| `app/reports/forecast-snapshots/page.tsx` | Shared compact action class |
| `e2e/tablet-controls.spec.ts` | Rendered tablet geometry, screenshots, and interaction checks |
| `e2e/responsive.spec.ts` | Phone and wide desktop control-size regression; attachment assertion waits for the upload response |
| `playwright.config.ts` | Chromium and WebKit projects at all three tablet widths |
| `docs/tablet-ui-audit.md` | Findings, scope, intentional differences, artifacts, and validation |

## Validation results

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript typecheck | Passed |
| Relevant unit tests | 16 passed across filter counts, report selectors and layout, Saved Views, entity search, and Activity contact picker rendering |
| Tablet control checks | 102 distinct checks passed across Chromium and WebKit at all three widths, including focused followups |
| Existing phone and desktop browser regressions | 78 passed; 5 intentional viewport-specific skips |
| Existing portrait and landscape tablet workflows | 11 passed; 1 intentional landscape skip |
| Production build | Passed in a temporary copy verified against the application, component, and library source trees |
| `git diff --check` | Passed |

Browser totals consolidate successful reruns of affected cases. Initial development runs exposed hydration and synthetic-input timing in the tests, and cold compilation delayed the attachment upload endpoint. The tests now wait for hydrated controls, settled touch focus, entered date values, and the actual upload response. The affected checks passed on focused reruns; the raw initial failures and successful followups remain in the validation logs.

The isolated test server was stopped after verification. No push or deployment was performed.
