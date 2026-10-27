# Request / Query Efficiency v1

## Before-change inventory (code inspection, 2026-10-26)

| Source | Repeated-call pattern | Frequency | Scope | Value |
| --- | --- | --- | --- | --- |
| `current-user.ts`, root layout and pages | `userContext()` and `currentUser()` independently call `auth()`; Dashboard also calls `getRealAuthenticatedUser()` | Every authenticated page | Request | High |
| `assignment-eligibility.ts`, selectors and reports | Sales-rep `findMany` is repeated by page loaders and Dashboard widgets | Common sales pages | Request | Medium |
| Dashboard page / widgets | Dashboard loads Sales reps, then Forecast Movement and Sales Plan Status each load the same IDs | Dashboard with both widgets | Request | High |
| Sales Plan page, report, export, helpers | Active Sales population is queried separately by each independent HTTP request; `planForecast` also queries it when no owner IDs are supplied | Sales Plan visits | Request | Medium; preserve separate export request |
| `saved-view-store.ts` | Each saved view validates each referenced Account, user, Project, Trade Show, stage, competitor, category, and Opportunity individually | Every list fetch, up to 50 views | Request | Very high |
| Work and Support notification evaluators | 200 IDs fetched, then each record, assignee eligibility, and current notifications fetched individually | Scheduled evaluator run | Batch | Very high |
| PE evaluator | PE and eligible users are batched, but current notifications and preferences are fetched per PE | Scheduled evaluator run | Batch | High |
| Support form options | Categories, assignees, and timezone fetched together; a separate `supportUserZone` repeats timezone on pages using both | Support forms | Request | Medium |
| Admin Ownership / Data Quality / lifecycle preview | Counts and eligibility use centralized policies but independent page loads compute independent totals | Admin visits | Request | Low to medium; no cross-request reuse |
| `module-availability.ts` | Already uses React `cache()` for the Prisma singleton; transaction reads intentionally bypass it | Most pages | Request | Already bounded |
| Branding / trusted / internal domains | Branding is fetched by root layout and some pages; domain reads occur in auth and admin paths | Every page for branding; sign-in for domains | Request | Medium; never cache across requests |

## Confirmed query growth before changes

* Fifty Saved Views referencing one owner each cause 50 user existence queries plus the Saved View list query. Each distinct relationship type has the same per-view growth.
* A 200 Task notification batch begins with an ID query, then calls `syncTaskNotifications()` 200 times. Each call fetches the Task, eligibility, operational status, and current notifications separately, before preferences or writes.
* A 200 Support Case notification batch begins with an ID query, then performs a Case and current-notification query per Case, plus eligibility and preference queries for applicable rows.
* The PE evaluator batches PE rows and eligible users, then reads current notifications once per PE and preferences once per candidate.

## Implementation and query counts

| Case | Before | After |
| --- | ---: | ---: |
| Account list owner selectors | 2 identical Sales-population reads (`accountOptions` plus `listSalesReps`) | 1 request-scoped read |
| Dashboard with Sales data, Forecast Movement, and Sales Plan Status | 3 active-Sales population reads | 1 shared population read |
| Sales Plan management page, all reps, no history | 3 active-Sales population reads (selector, participation, forecast) | 1 selector read reused by both helpers |
| Sales Plan report, all reps | 2 active-Sales population reads (selector and forecast) | 1 selector read reused by forecast |
| 50 Opportunity Saved Views, each with Account, Project, and owner filters | 151 reads: list plus 50 each for three relationships | 4 reads: list plus one read per relationship |
| 200 overdue Tasks | About 1,003 reads: settings, ID pages, 200 each of Task, user, operational status, current notices, and preference | 8 reads: settings, pages, operational set, two user-policy sets, notices, preference |
| 200 overdue Support Cases | About 802 reads: ID pages and 200 each of Case, user, current notices, and preference | 5 reads: pages, eligible users, notices, preference |
| 200 expiring Price Exceptions | About 403 reads: ID pages, eligible users, and 200 each of current notices and preference | 5 reads: pages, eligible users, notices, preference |

The before counts are derived from the original call paths. Saved View and notification after counts are asserted with isolated 50-view and 200-record test doubles; the request-cache test uses 60 users and asserts one shared Sales population query. The page population counts are structural call counts. These are query-operation counts, not production timings or database measurements. Writes are also grouped by batch where possible. PE expired message synchronization still updates individual expired notices because each message can differ.

`currentUser()`, `userContext()`, and `getRealAuthenticatedUser()` now share one request-scoped auth and impersonation resolution. Sales owner, Opportunity owner, Project owner, Trade Show routing, Demo owner, PE follow-up, Marketing owner, Task assignee, and Support assignee selectors use a narrow shared option loader. Policy names with identical eligible roles share one request-scoped population for the same sort order. Pipeline, Forecast, and Sales Target selectors now select only fields they use. The Dashboard passes one Sales population to Forecast Movement and Sales Plan Status. Sales Plan page and report pass their already loaded population to the forecast helper. Support form timezone reads share a request-scoped lookup. Root layout and page branding reads share a request-scoped lookup. Module availability already had request-scoped reuse; its transaction read path is unchanged.

The Saved View list validates each referenced model in one bounded query using the same Account, Project, Opportunity, active-user, and active-reference predicates as the previous per-view checks. The `unassigned` Account and `none` Project sentinel filters remain valid. Single-record validation is retained for callers outside list rendering.

Scheduled notification evaluation now fetches full bounded pages and batches user eligibility, operational predicates, stale Commit predicates, current notices, and preferences. Source keys, recipient policies, disabled preferences, deduplication, and resolution semantics remain in place. Write-time single-record sync and transactional checks remain unchanged.

## Request scope and freshness

React `cache()` in a Next server request memoizes a function's result and pending promise for that request/render. It does not persist across HTTP requests or users. The identity cache has no arguments because its scope is the active request. Eligible options are keyed by policy and sort order; timezone is keyed by user ID. Only the application Prisma singleton uses these caches. Transaction and test clients read directly. Mutation authorization, eligibility, domain, and module checks still read current state in their transaction; request memoization does not replace them.

Trusted sign-in and internal email domains remain uncached in their security-sensitive read paths. Branding and module settings are re-read on the next request. Admin counts, report results, Dashboard widget results, and mutation revalidation are intentionally uncached. No global mutable state, Redis, background materialization, or persistent user cache was added.

## Remaining hotspots and indexes

The Dashboard still executes distinct report/widget queries, and Ownership & Reassignment still runs 12 predicate-specific counts. Sales forecasting still queries each quarter, and expired PE notices still update message text individually. These are separate semantics or query shapes, so they were not folded into a speculative query in v1. No index or migration is proposed without an explain plan and approval.
