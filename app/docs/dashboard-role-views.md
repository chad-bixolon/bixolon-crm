# Dashboard role views

Role-Based Dashboard Polish v1 uses one dashboard renderer, the widget registry and system defaults in `lib/dashboard.ts`, and `composeDashboardSections` shared with the customization editor. A role chooses emphasis; existing authorization continues to determine available widgets, records, reports, and actions. No grants, route permissions, schema, or underlying module access changed.

## Inspection and resulting defaults

Previously Sales led with financial summaries, My Day appeared deep in Attention, Admin inherited almost all manager metrics, Marketing began with overdue Tasks, and Read Only had six sales widgets. Support already had its own four case widgets. Fixed section grouping overrode saved cross-section ordering in both the dashboard and editor.

| Audience | Default emphasis, in order |
| --- | --- |
| SALES | My Day and personal Tasks; own closing Opportunities; personal forecast and stage summary; forecast attention, assigned Trade Show leads, recent activity |
| SALES_MANAGER | Team forecast; salesperson Opportunity counts, Pipeline, Commit and targets; stage and closing summaries; forecast attention and activity; movement; team Tasks and personal My Day |
| SUPPORT | Assigned active cases with customer/internal waiting statuses; new/unassigned intake; priority and overdue case follow-ups; own case Tasks; oldest active cases; recent case activity |
| ADMIN | Data Quality / Cleanup; recorded job health and operational alerts; administration/integration shortcuts |
| MARKETING_MANAGER | Real campaign activity and influence counts; Trade Show lead routing overview; personal Tasks. Direct links to existing Lead Sources, Campaign Attribution and Audience views |
| READ_ONLY | Permitted forecast and stage summaries; informational links and currency selection. No dashboard customization CTA or record-edit/create controls |

Recent Items remains in the shared header for every role. Quick Create and contextual Quick Actions retain their existing permission behavior. A second history card would duplicate the header feature. My Day continues to use the real authenticated identity during development impersonation; CRM composition and scoped queries use the effective actor. Support and Read Only defaults do not include My Day: Support uses case work, and Read Only has no default personal work emphasis. Neither decision removes access to the existing personal page.

Role and personal layout overrides remain authoritative and are not rewritten. Reset to Role Default inherits the stored administrator default when present. Restore System Default in Administration removes that override. Prior-role personal layouts are ignored after role changes. Legacy widgets remain available to previously eligible roles through customization, including Sales Plan Status, price exceptions, product-category pipeline and stale Accounts.

## Data and query boundaries

- Sales KPIs use the current New York calendar quarter and selected currency. Individual amounts use `forecastForRep`; team amounts use `forecastForTeam`. Team coverage is unavailable when any required target is missing. No currency conversion occurs.
- Stage/closing summaries reuse the Pipeline report result and its operational/ownership scope. The salesperson widget reuses existing forecast counts and Pipeline amounts; it adds no query. Closing Opportunities remains a current-quarter, in-forecast list, with a deeper report link.
- Tasks Needing Attention retains the `OVERDUE_TASKS` persisted key for layout compatibility. It lists at most six open Tasks, oldest due date first, through the next seven days (today plus seven days). Sales and Marketing are personal; manager Tasks use active Sales/manager assignees. Selecting Tasks alone still loads the team population. My Day supplies today's counts; the Task card supplies follow-up details.
- Support uses `supportCaseReadWhere`, active statuses, and the existing Support dashboard service. Intake adds one count and one five-row query. Own case Tasks add one six-row query with operational parents, case visibility, and current-user assignment. Recent case activity adds one five-row query for the last seven days, with operational parents and case visibility. These additions run only when selected. Activity links to the case timeline, since Support has no general Activity-list permission. Priority represents HIGH/CRITICAL; no invented escalation model is implied.
- Admin reuses the fixed issue-count service and scheduled-job health service. Quality counts are review signals and may overlap. At most four nonzero issue groups appear with filtered links. Job states retain existing Healthy/Stale/Failed rules; absent runs are Stale. Live database/storage probes stay on System Health to avoid network calls on dashboard loads. No detailed admin report rows or job error payloads are loaded into a new dashboard report.
- Marketing reuses existing Campaign, influence, Audience and Trade Show counts. Attribution/conversion details remain in the existing reports. No new marketing query or attribution model was needed.
- Saved Reports retain the existing eight-pin cap and viewer authorization. The dashboard fetches only the selected pin definitions (at most eight); customization lists permitted reports. Existing report/forecast aggregation services are reused; this polish does not rewrite their historical row-based aggregation. New lists have explicit limits and no per-record queries.

## Presentation and deferred work

Adjacent sections group cards without changing layout item order. Cross-section moves now appear exactly where saved, including when stacked on phones. Shared cards use consistent spacing and full-height wrappers; grid items shrink within the page, and wide tables scroll inside their own cards. No empty section headings are emitted. Quiet states explain the role-specific absence of work; unsupported My Day and unavailable report pins do not create empty wrappers.

Secondary sales metrics were removed from defaults to reduce noise, while retaining customization eligibility. Marketing uses full-width cards to avoid a half-width orphan ahead of its core overview. Admin does not load sales data by default.

Deferred: WordPress ingestion and website conversion analytics (not implemented); new team activity trend charts (no shared dashboard trend service); predictive risk scores and dedicated escalation KPIs (no authoritative model); separate marketing first-touch/conversion dashboard aggregates (existing reports already provide deeper visibility). Existing forecast attention covers concrete stale Commit, close-date, category and amount issues without introducing risk scoring.

## Validation

Unit coverage validates all six compositions and eligibility, order across sections and report pins, personal/role inheritance, role changes, task scope/date boundaries, bounded Support queries and permission failures. Playwright covers all six roles at 1440, 768 and 390 pixels, header Recent Items, read-only controls, deeper links, access-denied routes, role changes, development impersonation, custom ordering and empty states. Screenshots are written to Playwright test output.
