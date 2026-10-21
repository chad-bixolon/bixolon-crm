# Saved Views

Saved Views are personal bookmarks for operational list filters. Saved Reports remain separate report definitions and output configurations.

The supported routes are Accounts, Contacts, Opportunities, Tasks, Projects, Price Exceptions, Demos, Support Cases, Products, Campaigns, Pipeline, Calendar Matches, and the Trade Show Follow-Up Queue (`/trade-shows/my-leads`). The Trade Shows event list itself is excluded because it has only an active/archived tab. The follow-up queue saves event, owner, search, lead and Task status, and rolling due-period criteria.

The JSON state contains only allowlisted URL query values for each route. Free-text Search is saved because it is a meaningful URL filter; temporary entity picker text is not. Deliberate sort choices are saved. Pagination page number, cursor, offset, page size, modal state, and filter disclosure state are excluded. Applying a view starts at the first page and uses the route's normal filter and permission logic.

Custom date filters retain the chosen calendar dates. Task relative periods store their meaning and roll forward whenever the list is loaded.

Opportunity Close Period stores `closePeriod=current-quarter` or `closePeriod=next-quarter` as a relative choice. Opening the view later evaluates the quarter at that time in the New York business calendar. An explicit value such as `closePeriod=2027-Q1` always selects that calendar quarter. `closePeriod=custom` stores `closeFrom` and `closeTo` as fixed dates; existing views with only those date fields open as Custom Date Range. Selecting another period clears the custom dates. Close Period counts as one filter, including a custom range with both dates.

Opportunity outcome criteria use `outcomeStatus` (`open`, `won`, `lost`), `actualCloseFrom`, `actualCloseTo`, and `outcomeReasonId`. Actual dates are fixed, inclusive date-only bounds, independent of Expected Close Period; the actual range counts as one filter. Reason IDs remain usable after deactivation or renaming, and the list preserves each deal’s stored reason label. Older Saved Views without these keys retain their original meaning. Clear retains the existing `/opportunities?closePeriod=` behavior and removes outcome criteria without changing the broader default-view policy.

Each user owns their views. One view per route can be the default. Opening a bare route applies that view once; an explicit query URL takes precedence. Selecting a view marks it active. Changing a filter labels it Modified without changing the stored view. Views can be renamed, made or cleared as default, or deleted in Manage views.

An Account or Project ID that is archived, removed, or inaccessible is omitted when a saved view is loaded, with a short warning when the view is selected. Other outdated filter values pass through the existing route parser, which handles unknown values. Saved Views never grant record access. On mobile, Search remains visible, Filters stay collapsed until opened, and their active count reflects the applied query.

## Rolling Task due dates

Tasks offer a single Due date control: Any due date, Overdue, Due today, Next 7 days, This week, and Custom date / range. Assignee and every other existing filter continue to compose with it. No personal views are seeded or changed automatically.

| Period | Eastern business-date semantics |
| --- | --- |
| Overdue | Due date before today. |
| Due today | Due date is today. |
| Next 7 days | Today through seven calendar days from today, inclusive (eight dates). Matches the existing dashboard's upcoming window. |
| This week | Monday through Sunday of the current New York week, including days earlier in that week. Matches the existing snapshot week boundary. |
| Custom date / range | Fixed From and Through dates, both inclusive. Either bound can be omitted; use the same date for both to select one exact day. |

All relative periods exclude undated Tasks. They exclude completed Tasks unless Status is explicitly Completed; explicit Open, In Progress, Completed, and Cancelled selections remain authoritative. Cancelled Tasks retain their existing visibility when no status is selected. Any due date and custom ranges retain existing status behavior, including completed Tasks. Any due date also allows undated Tasks to appear.

The additive `duePeriod` query key accepts `overdue`, `today`, `next-7-days`, `this-week`, or `custom`. A saved relative view contains only that key plus other chosen filters (for example `{"assignedToId":"7","duePeriod":"overdue"}`), with no resolved `dueFrom`/`dueTo` values. Selecting a relative period clears custom inputs, and server normalization discards stale absolute bounds. A Saved View for My Overdue Tasks continues to show whatever is overdue whenever it is opened, including months later.

Legacy Task views containing only `dueFrom`/`dueTo` keep their stored shape and fixed-date meaning; no rows are rewritten and no migration is required. They open with Custom date / range selected. An explicit `duePeriod=` clears due-date filtering and lets Clear override a personal default without reapplying it. The whole due-date control counts as one active filter.

`business-date.ts` extracts the existing New York `businessToday` calculation; Price Exceptions re-export it for compatibility. Task `dayBounds` and snapshot `snapshotWeek` delegate to its day/week helpers. UTC-midnight values represent date-only labels; calendar arithmetic never adds elapsed hours to an Eastern midnight instant, so DST cannot shift Task membership. The server captures one `now` and creates one `taskWhere` criterion reused by count and ordered/paginated row queries. There is no Task list export route. Dashboard/My Day behavior, permissions, bulk eligibility, impersonation, default sorting and personal defaults are preserved. My Day intentionally retains its selected user timezone and date.

The Due date selector waits until its client handler is ready before accepting changes, so rapid interaction during a slow load cannot leave Custom selected without its inputs. A hidden fallback preserves the selected period in native form submissions during startup. Reapplying an already-selected relative Saved View refreshes the server results even when its URL is unchanged.

### Rolling Task Periods v1 files

| Area | Files |
| --- | --- |
| Shared business dates | `app/lib/business-date.ts`, `app/lib/price-exception-dates.ts`, `app/lib/opportunity-snapshots.ts` |
| Task criteria and filter counts | `app/lib/task-due-period.ts`, `app/lib/work.ts`, `app/lib/filter-count.ts` |
| Task filter UI | `app/app/tasks/page.tsx`, `app/components/task-due-period.tsx`, `app/components/filter-disclosure.tsx` |
| Saved View state and application | `app/lib/saved-views.ts`, `app/components/saved-view-control.tsx` |
| Help and documentation | `app/lib/help/topics.ts`, `app/docs/saved-views.md`, `CHANGELOG.md` |
| Focused tests | `app/tests/task-due-periods.test.mjs`, `app/e2e/task-due-periods.spec.ts` |

### Validation — October 17, 2026

Validated with Node 22.23.3 in the isolated `rolling-task-periods-v1` checkout based on `75ef77d`. No commit, push, localhost:3000 deployment, live migration, or DigitalOcean change was performed.

- `npm run lint` and `npm run typecheck`: passed after the final control-readiness fix.
- 119 tests passed across 15 focused unit suites: Task due periods, Saved Views, work, Task workflow, archive cutover, Price Exception business dates, Opportunity Snapshots, weekly snapshots, My Day, Dashboard, Support Dashboard, impersonation, bulk actions, Help and filter counts. The new due-period cases cover later simulated reloads, both midnight boundaries, both DST transitions, Monday/Sunday and year boundaries, fixed-date compatibility, status/assignee composition and permission preservation.
- All four new Playwright tests passed in the final run against the dedicated `saleshub_e2e` database and port 3100. These cover each period's actual database rows, completed/undated behavior, absolute dates, unapplied relative-view saves, persisted JSON, reload/application, reapplying the same URL, Clear with a default, matching counts and ordered pages over 25 records, and Read Only restrictions. The browser timezone was Asia/Tokyo.
- Phone 390×844, tablet 768×1024 and desktop 1440×900 checks passed, including document overflow assertions; six relative/custom screenshots were visually reviewed and saved under ignored `app/reports/task-periods-validation/screenshots/`.
- Thirteen existing Playwright regressions passed across Saved Views and bulk actions. Two existing Opportunity tests still fail: `Opportunity Close Period stays compact and custom dates appear only when selected` and `Opportunity Project filter keeps Project and No Project exclusive and restores No Project views`. Both failures reproduced against the original committed application on port 3131 using a separate baseline checkout; only test port and view-name isolation were adjusted there. The first fails when reopening cleared mobile controls; the second retains the prior hidden Project ID after checking No Project. No Opportunity behavior was changed to address these unrelated failures.
- Final `npm run build -- --webpack`: passed, including TypeScript, 43 static pages and build traces. Browser validation used a temporary ignored Playwright config with a webpack development server; product build configuration is unchanged.
- `git diff --check`: passed. No schema migration or saved-row rewrite is needed. No Task date-policy question remains unresolved; Cancelled visibility follows existing status behavior, and Next 30 Days was omitted to keep v1 focused.

Detailed logs, the temporary test config and screenshots are retained in ignored `app/reports/task-periods-validation/`. Earlier browser attempts exposed the new control's startup interaction issue and test-selector mistakes; the final four-test Task run passed after those corrections. The two baseline Opportunity failures remain separate from the Task feature results.
