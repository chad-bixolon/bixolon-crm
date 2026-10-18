# Pipeline Movement v2

Entry: Reports → Pipeline Movement → Historical trends & outcomes (v2), at
`/reports/pipeline-movement/history`. The original snapshot comparison remains at
`/reports/pipeline-movement`. V2 describes captured pipeline evolution and deal
outcomes. It adds no rep rankings, scores, leaderboards, AI output, predictions,
recommendations or risk scoring.

## Architecture

- `app/lib/pipeline-movement-history.ts`: pure analysis of bounded captures and
  separately supplied authoritative outcomes. Uses private 40-digit Decimal
  arithmetic, the existing unmodified `analyzePipelineMovement` engine, and
  explicit participation/category/closure-evidence options.
- `app/lib/pipeline-movement-history-report.ts`: SalesHub adapter, effective actor
  authorization, existing rep-selection policy, calendar-quarter boundaries,
  indexed bounded snapshot queries and source-linked Forecast Snapshot metadata.
- `app/app/reports/pipeline-movement/history/page.tsx`: dynamic server-rendered
  report, GET filters, calculated tables and paginated deal detail.
- `app/components/pipeline-history-chart.tsx`: small accessible SVG line chart.
  Numbers are used only for chart coordinates; financial results retain exact
  Decimal strings and the existing currency formatter.

V1 reconciliation, allocation precedence, immutable snapshots and capture
workflows are unchanged. V2 invokes v1 for every adjacent observed interval and
for its selected first-to-last executive movement drivers. Every Opportunity
receives one delta per comparison. Adjacent movement sums and first-to-last
movement drivers intentionally describe different views when deals re-enter.

Forecast Snapshot rollups are derived from the same Opportunity source. V2 reads
source-linked complete QUARTERLY_V1 Forecast Snapshot references and presents the
source ID in the trend table. It calculates from the underlying frozen
Opportunity rows to preserve Account/category filters and v1 legacy eligibility
policy; it does not sum forecast rollups into Opportunity totals. Linked rollups
require known true owner eligibility, while v1/v2 include legacy unknown
eligibility. Thus a legacy comparison is not asserted equal to those rollups.

No migration, persisted movement events, multi-tenancy, billing, cache or
precomputation was added. No company name or stage name is embedded in the
engine. Forecast keys and closure evidence are provided by the SalesHub adapter.
Without category keys, category metrics are unavailable while basic amount,
expected close, stage/status and actual outcome analysis continue to work. Future
products can omit forecast UI; no forecasting configuration system is introduced.

## Trend calculations and windows

Only captures within the selected calendar quarter participate. Rolling windows
end at its latest available captured week, with an inclusive lower boundary 4, 8
or 12 weeks earlier (up to 5, 9 or 13 observations). Week boundaries use captured
`snapshotWeek`, so changes in capture time or DST do not drop the boundary week.
The quarter view includes its first available capture, not an invented opening
balance. Partial history is explicitly shown by capture dates and count.

For each week, Pipeline is the captured open participating value, including Best
Case and Commit; category totals are subsets. Captured Closed Won is the total
Won value present in that snapshot, grouped by captured Expected Close Date.
This is a cumulative snapshot observation, never the sum of weekly Won totals,
and is distinct from current Actual Close results. Open-only legacy captures
have unknown Closed Won, not zero. Closure/reopening/amount changes can lower a
later captured Won observation; this is reported factually.

Slipped-out movement is the positive magnitude of the adjacent v1 slipped bucket.
New/entered movement sums v1 additions and entered-period allocations. Cumulative
values start at zero at the first selected observation and sum subsequent
intervals. A missing capture creates a longer observed interval, never a
fabricated intermediate week. Chart lines break at missing weeks. No first-week
interval delta is invented. Repeated exits/re-entries remain repeated movement
observations, while distinct deal outcome totals count each Opportunity once.

Executive summary is calculated labels and tables: endpoint Pipeline/Commit/Won
changes, interval cumulative exits/entries, and up to five positive/negative
endpoint drivers. No commentary generation is involved.

## Cohorts, actual results and reopened deals

Cohorts contain the snapshot's in-scope OPEN deals in Commit, Best Case or all
participating categories. The user can select a capture in the quarter. Default:
latest capture on or within seven calendar days before the date four weeks
before quarter end. If none exists, the report asks for an available snapshot;
it does not substitute an arbitrarily stale cohort.

Historical value, owner, currency, Account membership and category remain frozen.
Current authoritative Opportunity stage, Expected Close Date, Actual Close Date
and saved `outcomeReasonName` supply the current result. Reads of current fields
and live/archived outcome events use one repeatable-read transaction. No current
product, owner or Account data rewrites cohort membership or money. Current
outcome amounts are intentionally not summed: value is the historical cohort
amount in its captured currency, even if today's currency/amount changed.

- Won in selected period; Won later; Won earlier; Won with unknown actual date.
- Lost, with its actual date independently classified if present.
- Open in another dated quarter: slipped to another quarter; otherwise still open.
- Missing authoritative record: outcome unavailable, never guessed from absence.

Expected vs Actual Close compares calendar quarters: same quarter, earlier or
later. Open deals remain open, with a separate cross-quarter date label. Closed
legacy records with null Actual Close Date remain **actual close unknown**.
History timestamps never supply a missing date. The exact expected and actual
dates remain available in cohort detail.

Conservative reopened rule: current authoritative state is one current outcome,
using the latest recorded actual closure fields when closed. A currently open
reopened deal contributes no prior win/loss. Prior CLOSED, OUTCOME_REOPENED and
OUTCOME_UPDATED events are shown as context, including their before/after saved
values. Archived events use source IDs for deduplication against live copies.
Latest event disagreements in status, recorded actual date or saved reason are
flagged for review; missing legacy events remain explicitly incomplete context.
No event is counted as another Opportunity in top-line totals.

## Slippage and reasons

The dedicated list records each deal at its first v1 financial slip in the
selected window, including date clearing and movement to an earlier period.
Value and category come from before the slip; original/at-slip/current-or-actual
quarters remain distinct. Weeks moved is the signed expected-date difference
rounded up to weeks; an earlier-quarter move is explicitly labeled and cleared
dates stay unknown. It measures date displacement, not time elapsed since slip.

Distinct first-slip value is separate from cumulative exit movement. Later Won
requires a known latest Actual Close Date on/after the observed slip date; open
and Lost counts use current state. A simultaneous captured closure takes v1's
closure allocation precedence, so the report does not invent a preceding slip.
Changes wholly inside missing intervals cannot establish their ordering.

Reason views use each deal's first in-scope observation in the chosen window and
its latest current Won/Lost outcome, including deals already closed when first
observed. Previously Commit requires an in-scope open Commit capture in that
window. Lost-after-slip requires a v1 slip observed on/before the latest Actual
Close Date. Same-day dates establish only calendar-day order, not intraday order;
unknown actual dates cannot establish the sequence. Reopened prior reasons remain
context, not extra top-line groups. Saved historical reason labels are used,
without joining current reason names or filtering inactive reasons.

## Quarter comparison

Users choose any different supported year/quarter, including previous quarter or
same quarter last year. Availability requires at least two matching relative
capture weeks, calculated from each quarter's start, and identical forecast-ready
scope versions at matched endpoints. Unknown/open-only Closed Won history cannot
enable comparison. Missing weeks are omitted; values are never interpolated.
Interval slippage is comparable only when the prior capture also has a matching
relative week and scope. Otherwise those interval cells are unavailable.

Selected progression uses its rolling/full-quarter selection; the comparison
quarter uses its bounded available captures. Outcome mixes use distinct deals
observed in matched capture weeks and current outcomes. They are descriptive:
quarters have different follow-up durations and incomplete historical coverage.

## Dimensions, visibility and UI

Sales defaults to self and may intentionally select another active eligible Sales
or Sales Manager rep. Team totals remain for Managers/Admins. Effective
impersonation controls authorization and defaults. Current Opportunity outcomes
use the existing cross-Sales read policy. Historical inactive owners remain in
team captures; the existing eligible-rep selector is unchanged. Unknown legacy
eligibility remains included as in v1. No new owner-policy decision is required.

Currency is required and singular throughout; unlike currencies never share a
sum. Owner/Account/category participation is evaluated at each captured endpoint,
so transfers become entries/exits. Account and owner movement tables retain each
endpoint's captured group and name, and cohort outcome groups retain the chosen
snapshot's membership. Multi-Account groups overlap and are explicitly
non-additive. Groups are alphabetical, with at most 100 shown and filters to
narrow them. Deal tables paginate at 50. Product snapshots contain only a count,
so historical family/line analysis is deferred until reliable captured detail
exists; live product joins are deliberately excluded.

The SVG chart shows Pipeline, Best Case, Commit and Closed Won with exact-value
data below. It scrolls in its own container on mobile/tablet. Unknown values and
gaps do not become zeros. Waterfall is deferred: there is no installed charting
stack, and adding one solely for a waterfall would add unnecessary complexity.
The existing v1 signed reconciliation remains the exact financial explanation.

Help topic `pipeline-movement` covers multi-week/quarter views, cohorts, timing,
reopened deals, slippage, reasons, historical dimensions and quarter comparison,
using practical, descriptive wording. Existing v1 guidance remains.

## Performance

At most 15 weekly run metadata records per quarter are accepted (query takes 16
to detect overflow). Each run remains capped at 10,000 rows. Rolling selections
load only their window, plus an explicitly separate cohort capture if needed;
a comparison adds at most one bounded quarter. Completed row counts must match
metadata; incomplete or oversize reads fail visibly rather than truncate.
Metadata uses the snapshotAt index and rows use runId indexes. No all-history
Opportunity Snapshot scan occurs for a rolling window.

Current outcome IDs are restricted to historically qualifying selected or
comparison rows. More than 20,000 distinct Opportunities, or more than 50,000
combined outcome-history events, requests narrower filters rather than silent
loss of context. Outcome-event reads use the Opportunity/history index and merge
live/archive records in memory. Events are loaded only for selected current IDs.

Trend compute is O(w × n) plus v1 sorting per comparison; captures are indexed by
run and outcomes by Opportunity. Endpoint groups are linear in rows and captured
Account memberships. No persistent cache is justified by current measured usage.
Investigate aggregation/caching if p95 compute/query exceeds 1 second, report
latency exceeds 2 seconds under expected concurrency, or existing caps need to
increase. Benchmark real usage before choosing snapshot-only caching versus
outcome caching (which also requires live invalidation). Large maximum-size
windows remain bounded but can need several seconds; no production latency is
claimed from synthetic tests.

A synthetic five-capture run with value changes on every deal measured 557ms
for 1,000 rows/capture and 2,890ms for 10,000 rows/capture in this environment
while validation tasks were running. This measures the pure engine, excluding
queries, serialization and rendering. Maximum-size windows warrant workload
measurement against the investigation thresholds above.

## Validation

Validated with Node 22.23.3:

- ESLint: passed, no warnings.
- `npm run typecheck`: passed.
- 107 focused unit and relevant regression checks passed: 18 v2 cases, 23 v1
  cases, and 66 forecast, snapshot, weekly capture, outcome and Help checks.
- 45 existing Playwright regressions passed for v1, Opportunity/Forecast/weekly
  snapshots, Opportunity outcomes and Help.
- All 7 v2 Playwright tests passed, including window changes, cohorts, unknown
  actual dates, reopened history, reason filters, slippage, compatible and absent
  quarter history, immutable Account membership, cross-Sales viewing, denied
  roles, actual impersonation and desktop/tablet/mobile layouts.
- Responsive checks cover 1440×900, 768×1024 and 390×844 with no document
  overflow. Charts and wide tables scroll within their containers. Screenshots
  are generated under the ignored `app/reports/pipeline-movement` directory.
- Production webpack build passed with the isolated E2E database URL; both v1
  and v2 routes remain dynamic server routes.
- `git diff --check`: passed. V1 engine/adapter and Prisma schema/migrations
  have no changes.

The initial command regression/build attempts hit sandbox subprocess restrictions
and passed with the necessary process access. Browser validation caught and
resolved an SVG title hydration issue. Fixture-only fixes preserve required
manual-capture attribution and atomic snapshot insertion. Final browser checks
reject uncaught application errors and hydration warnings.

Only the dedicated `saleshub_e2e` database is used by browser fixtures. Production
data/infrastructure are unchanged. No commit, push or deployment was performed.

## Changed files

- `app/lib/pipeline-movement-history.ts` — generic history/outcome/group engines.
- `app/lib/pipeline-movement-history-report.ts` — bounded authorized adapter.
- `app/app/reports/pipeline-movement/history/page.tsx` — v2 report and filters.
- `app/components/pipeline-history-chart.tsx` — SVG chart.
- `app/app/reports/pipeline-movement/page.tsx` — v2 link preserving filters only.
- `app/app/reports/page.tsx` — report entry description.
- `app/lib/help/topics.ts` — expanded practical Pipeline Movement guidance.
- `app/tests/pipeline-movement-history.test.mjs` — 18 focused history tests.
- `app/e2e/pipeline-movement-history.spec.ts` — browser/database coverage.
- `docs/pipeline-movement.md` — link from v1 documentation.
- `docs/pipeline-movement-v2.md` — architecture, rules, limits and validation.


## Pipeline Movement UI Polish

Both existing routes now present one Pipeline Movement report with two sibling
views: **Weekly Comparison** and **History & Outcomes**. A shared
`app/components/pipeline-movement-header.tsx` owns the title, Reports link, view
switcher and single contextual Help link. Active links use `aria-current="page"`;
shared year, quarter, currency and salesperson filters carry across views.
The active view link retains its URL parameters. Existing routes and bookmarks
continue to resolve directly; no engine or route-selection rules were merged.

Presentation changes:

- Developer version labels were removed from both pages and Help navigation.
- Forecast Outcome Analysis, Reference Snapshot, Reference Category, Outcome View,
  Value at Snapshot, Deals That Slipped, and Account & Owner Movement replace
  technical report labels.
- Year, Quarter, Comparison window, Salesperson, Currency and Forecast Category
  stay visible. The existing native-disclosure pattern holds Account, reference,
  outcome and quarter-comparison filters under Advanced filters. Closed controls
  remain mounted and submit normally. Selecting a default Reference Snapshot
  alone does not expand Advanced filters after a common-filter update.
- Period Summary uses five clear metric cards and a disclosure for movement
  drivers; every financial expression and result is unchanged.
- Helper copy is shorter. Detailed methodology stays in the existing Help topic.
- Empty states distinguish absent weekly history, limited history, no matching
  Opportunities, and valid zero movement. A single snapshot displays its table
  and a trend-availability note; two snapshots have a short limited-history note.
- The same SVG chart has a concise legend, currency title and larger axis labels.
  No series data, charting dependency or financial calculations changed.
- Shared SalesHub fields retain 44px tablet sizing. View links and the Advanced
  filters disclosure provide at least 44px touch targets.

The analysis/adapter, permissions, schema and all 78 migration files were
fingerprinted before this pass: all 84 protected files remain byte-for-byte
unchanged. Browser fixtures use only the dedicated local E2E database.

Files changed in this presentation/navigation pass:

- `app/components/pipeline-movement-header.tsx` (new shared report header).
- `app/app/reports/pipeline-movement/page.tsx`.
- `app/app/reports/pipeline-movement/history/page.tsx`.
- `app/components/pipeline-history-chart.tsx`.
- `app/lib/help/topics.ts` (Pipeline Movement wording only).
- `app/e2e/pipeline-movement.spec.ts` (updated copy expectations).
- `app/e2e/pipeline-movement-history.spec.ts` (updated labels/disclosure access).
- `app/e2e/pipeline-movement-ui.spec.ts` (new presentation/navigation checks).
- `app/playwright.config.ts` (focused Chromium/WebKit tablet and phone projects).
- `docs/pipeline-movement-v2.md` (this implementation record).


Polish validation (Node 22.23.3):

- 48 relevant unit checks passed (23 Weekly Comparison, 18 history, 7 Help).
- 20 Chromium browser checks passed, including both existing Pipeline Movement
  suites, direct bookmarks, shared-view navigation, permissions/impersonation,
  Advanced-filter submission while closed, empty/limited/zero states, and layouts.
- 3 WebKit/iPad-style checks passed at 768, 820 and 1024px. Chromium covers the
  same tablet widths plus desktop 1440px and phone 390px. Visible tablet fields
  measure 44px; screenshots of filters, summary cards and charts were reviewed.
- Production webpack build passed; original routes remain dynamic server routes.
- Lint, standalone typecheck and `git diff --check` passed.

WebKit uses the existing locally unpacked Playwright dependency cache. Missing
libraries were downloaded/unpacked into that ignored development cache only;
no system packages were installed. Its global `ldconfig` precheck cannot see
local libraries, so the final WebKit test process used
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true` after checking the actual local
library dependencies. Browser launches, navigation, rendering and uncaught-error
checks all ran normally. A test-only navigation wait ensures the streamed Help
page finishes loading before the next navigation; error assertions remain intact.

The first overlapping typecheck/build attempt saw transient missing generated
Next.js type files. The final standalone typecheck ran after build completion.
Next-generated instruction/environment/configuration changes are excluded from
the final diff. No commit, push, deployment, DigitalOcean change, schema change
or production-data modification was performed.
