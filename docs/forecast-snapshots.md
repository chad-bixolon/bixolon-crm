# Forecast Snapshots v1

A Forecast Snapshot preserves the quarterly sales forecast at an Opportunity Snapshot's capture time. Current Opportunities remain the source of truth for current sales work. This feature changes no Opportunity save, live forecast, stage, product valuation, target, coverage or dashboard calculation. It installs no schedule and fabricates no historical values.

## Inspected live forecast

`app/lib/forecast.ts` calculates forecast amounts from operational, unarchived, open Opportunities. Value is active product quantity × estimated unit price, using decimal arithmetic. Management totals include active, unarchived SALES and SALES_MANAGER owners. A manager without a target still contributes forecast amounts; quota membership affects target/coverage only. There is no manager-to-salesperson hierarchy. SALES sees owner-scoped live reporting; ADMIN and SALES_MANAGER already have team Opportunity visibility.

Pipeline is the inclusive sum of PIPELINE, BEST_CASE and COMMIT. Best Case and Commit are explicit, unweighted category subsets. OMITTED and closed stages do not enter open Pipeline. Stage does not imply Commit. Weighted Pipeline applies the Opportunity probability override, otherwise the stage probability. The live totals and coverage are derived; an older `ForecastSnapshot` / `ForecastSnapshotArchive` system stores independent weekly live-derived aggregates used by existing Forecast Movement and dashboard widgets. Those tables, capture/retention services, reports and widgets remain unchanged. The new report is **Forecast Snapshot History** and uses the source-linked models below. Do not mix the two histories or interpret the legacy data as source-linked history.

## Source and model

`ForecastSnapshotRun` stores the source Opportunity Snapshot Run ID, source capture timestamp, separate creation timestamp, creator ID/name, year/calendar quarter, included Opportunity count, distinct salesperson count, row count, COMPLETE status and QUARTERLY_V1 rules version. A unique constraint prevents more than one run for a source/year/quarter. No partial runs are committed.

`ForecastSnapshotRollup` stores only nonempty owner/currency/category groups, with decimal amount, Opportunity count, copied owner ID/name, enum category and copied category label. Year, quarter and timestamp are inherited from the immutable parent. Pipeline's inclusive total is calculated from the three open category groups rather than stored twice. Closed Won has a CLOSED category row. Unassigned/ineligible deals are preserved in the source, but do not enter forecast totals.

The preexisting name `ForecastSnapshot` is already occupied by the legacy feature. The new rollup model has a distinct name to avoid changing that feature's semantics or retention behavior.

Historical entity IDs and names have no mutable live foreign keys. Only run relationships have restrictive foreign keys. Database triggers reject update, delete and truncate, prevent rows being appended after the creating transaction, check run counts, and validate exact stored rollup amounts/counts/names/categories against source rows. Empty runs are valid and immutable. There is no edit, replacement, purge or archive operation for this new history.

### Forecast-ready Opportunity Snapshot scope

The normal open-only Opportunity Snapshot capture is unchanged. Its nullable new `ownerForecastEligible` field remains unknown. Admins can explicitly select **Forecast-ready scope** on the same Opportunity Snapshot capture screen/service. This uses scope version `FORECAST_OPERATIONAL_V1`, captures open **and Closed Won** Opportunities under the same existing operational Account/Project rules, and freezes owner eligibility for each row. An owner is eligible when active, unarchived and SALES or SALES_MANAGER at source capture. Renaming, deactivating, reassigning or changing a user's role later cannot rewrite those inputs.

All source rows are read under Repeatable Read, fingerprinted in preview, and captured atomically through the existing shared snapshot service. Owner eligibility changes invalidate that preview. The existing one-source-run-per-New-York-week rule still applies across both scopes. Choose scope before capture: an open-only run cannot be upgraded, replaced, or supplemented with a second run that week. Already committed rows are never backfilled.

Forecast capture requires an explicitly selected COMPLETE forecast-ready source. It reads only immutable Opportunity Snapshots, never live Opportunities, users for eligibility, products, stages, targets, or today's currencies. Only creator identity is read live. An older open-only run fails visibly because its missing eligibility and closed outcomes cannot safely be reconstructed. A source can be rolled up later; the historical timestamp is always its original capture time, not the rollup creation time.

## Exact rollup and period rules

Calendar quarters reuse `business-quarter.ts`: Q1 January–March, Q2 April–June, Q3 July–September, Q4 October–December. Expected Close Date determines period membership. UTC inclusive quarter start and exclusive next-quarter start match the application's date-only values stored at noon UTC and its New York business calendar. There is no fiscal calendar or month forecast.

Include a source row only if its captured owner is forecast-eligible and assigned, and Expected Close Date is inside the chosen quarter. Then:

| Captured status/category | Stored group | Reporting metric |
| --- | --- | --- |
| OPEN / PIPELINE | PIPELINE | Pipeline |
| OPEN / BEST_CASE | BEST_CASE | Pipeline and Best Case |
| OPEN / COMMIT | COMMIT | Pipeline and Commit |
| WON / any category | CLOSED | Closed Won only |
| OPEN / OMITTED or CLOSED, LOST, missing date, outside period, ineligible owner | None | Excluded |

Won status comes from captured stage `isClosed && isWon`, the authoritative status rule. Normal Opportunity saves assign CLOSED to won stages and OMITTED to lost stages. If an imported source has an inconsistent category on a won-stage deal, captured WON still establishes Closed Won, and the original source category remains available in drill-through. It never contributes open Pipeline.

Opportunity count means included open forecast **plus won** deal count, counted once each. Salesperson count means distinct owners with at least one included deal, including zero-value deals. Category counts are stored separately. Zero-value groups remain present; absent groups in a completed run mean zero. A nonexistent run means unavailable history, not zero.

No actual closing/booking date exists in the current Opportunity model. **Closed Won means captured won-stage value assigned by Expected Close Date**, not realized revenue, recognized revenue, date of actual win, or an irrevocable final outcome. Won deals remain subject to the source's operational/archive rules. An absent deal cannot establish won/lost; in particular a later archive or inactive Account can remove a formerly won deal from scope.

No authoritative FX conversion exists. Every preview, comparison and salesperson history stays partitioned by original currency code. Currency names/rates and live active flags are not used to reinterpret historical values. No mixed-currency grand total is shown. Targets, weighted forecasts and coverage snapshots are not needed for this v1 rollup.

## Manual process and permissions

1. ADMIN opens Administration → Opportunity Snapshots, selects forecast-ready scope, previews, reviews and explicitly confirms a source run. The source screen describes open + Closed Won scope. Existing open-only capture is still available.
2. ADMIN opens Administration → Forecast Snapshots and selects the source run, forecast year and quarter.
3. Preview shows the source run ID/time, period, included Opportunity count, salesperson count and Commit / Best Case / inclusive Pipeline / Closed Won / count totals separately for each currency. Zero-result quarters are explicitly identified.
4. Check the confirmation box and confirm. The user-bound, domain-separated signed preview expires after 15 minutes. Source and period inputs cannot be tampered with. The transaction rechecks compatibility and uniqueness and inserts parent and rows atomically.
5. Open Reports → Forecast Snapshot History. Duplicate confirmation or a concurrent attempt cannot create a second run for the same source/quarter. A source can support multiple distinct quarters.

Capture requires ADMIN at route, action and service. Reports require active ADMIN or SALES_MANAGER at route and service. No new SALES historical access is implemented in v1. No role gains live Opportunity visibility. Effective impersonation identity and normal mutation safeguards are reused. No writes or automatic captures occur during report visits.

## Comparison and explanations

Choose two source dates for the same forecast quarter, salesperson, currency, and optional source capture date window. Run pickers show up to 104 runs; use date windows for older history. Owner options come from preserved rollup names (bounded to 201 choices), not live users. Comparisons retain owner IDs present at either endpoint, show historical names and rename context, and treat absent groups in complete runs as zero.

Each metric displays previous/current amount, signed absolute difference (`current - previous`), and `(current - previous) / abs(previous) × 100`. Any zero baseline produces an em dash with a zero-baseline explanation, including 0 → 0. All arithmetic uses decimals. Count movement uses the same rule. Team and salesperson results stay separate by currency. The server fetches both runs/rollups together without per-salesperson queries; report rendering pages salesperson/currency groups in batches of 25.

Select **Explain movement** (or **View Opportunities** when net change is zero) to open the existing Opportunity Snapshot comparison, linked by the two source run IDs. It matches period, currency, owner and metric/category on **either** endpoint, then retains both snapshots. This prevents a reassignment, date shift, category transition or currency change being mislabeled as disappearance. Shared comparison logic shows amount, stage, category, owner, close date, status and eligibility changes. Period-aware membership labels show entry/exit from the selected slice. A missing source endpoint remains an unknown scope exit, never an invented loss or win. A zero net total can still contain offsetting deal movements.

Select a salesperson in Forecast Snapshot History for a compact latest-eight-run view of Commit, Best Case, Pipeline and Closed Won for the chosen period, separated by currency. The full comparison on that same report provides drill-through details. No dashboard forecast behavior changes.

## Accuracy foundation and future automation

A future accuracy report can choose an earlier forecast run and a later, explicitly designated outcome cutoff for the same quarter/currency. The historical rollups give the earlier forecast values and later captured Closed Won totals. Joining the linked Opportunity Snapshot sources by Opportunity ID can measure how much of the **earlier cohort** was subsequently captured WON, distinguishing original forecast value from later won value, owner transfers, category changes, currency changes, exits and reentries. A future report must define original versus outcome owner attribution, freeze/cutoff policy, restatements and unknown exits before scoring. A reliable booking-date accuracy report additionally requires an authoritative actual-close/booking date and potentially a broader outcome scope. v1 does not label the latest snapshot “final actual” or calculate accuracy scores.

There is no scheduler. Future weekly automation should:

1. Capture a forecast-ready weekly Opportunity Snapshot using the shared `previewOpportunitySnapshot(..., true)` / `captureOpportunitySnapshot` service, with explicit authorization and a documented New York capture time.
2. Call `previewForecastSnapshot` / `captureForecastSnapshot` for the required calendar quarters, always passing that source run ID. The rollup service itself never captures live deals. Treat source/period uniqueness as idempotent success only after verifying an existing complete run.
3. Alert/report only on failure or a missed run. Do not send routine successful alerts. Add job identity/source attribution, retry state and operational logs when implementing scheduling.

A source creation failure rolls back that source. A forecast failure leaves the complete source available for a safe retry; it leaves no partial Forecast Snapshot run. Reuse the same server services rather than introducing a separate forecast calculation in the job.

## Storage estimate and deployment

Read-only production inventory on October 15, 2026: **7 Opportunities total, 6 eligible open, 0 eligible won**, **5 active salespeople** (4 SALES + 1 SALES_MANAGER), **1 current Opportunity currency (USD)**. Forecast-ready source storage at current population is `52 × 6 = 312` deal rows plus 52 source runs/year. It shares the source set with Opportunity history, rather than duplicating deals in this rollup.

For one quarterly forecast per weekly source, the category ceiling is `52 × 5 owners × 1 currency × 4 categories = 1,040` small rollup rows/year plus 52 Forecast Snapshot runs. At today's six source deals, nonempty group storage is further bounded to **312 rollup rows/year** (often fewer after date/category/owner filtering). Per source/quarter the general bound is `min(included Opportunities, eligible salespeople × currencies × 4)`. Multiply by weekly runs and selected period scopes; distinct quarter scopes partition the source deals, so the source deal count also bounds total nonempty groups across disjoint quarters. At 1,000 source deals, 25 salespeople and 2 currencies, a single-quarter ceiling is 10,400 rollup rows/year plus 52 parents; source history would have 52,000 deal rows/year. Won-source growth must be included in future planning because operational, unarchived won deals remain captured. No per-edit auditing, notes, descriptions, attachments, product-line copies or additional deal rows are stored in the forecast tables.

These are row estimates, not measured disk sizes. Text length, indexes and PostgreSQL overhead affect bytes. Capture is bounded to the existing 10,000-source-Opportunity limit and fails without truncation. Source reads, comparison queries and history queries are batched. Indexes cover source+period uniqueness, period+timestamp, timestamp+ID, rollup run/owner/currency/category, and source run/Expected Close Date/currency/category.

Migration: `app/prisma/migrations/20261015160000_forecast_snapshot_runs/migration.sql`. Deploy forward using the existing migration procedure and regenerate the runtime Prisma client before using new source capture or Forecast Snapshot pages. No production migration or production snapshot is performed during implementation. Prior rows remain unknown/open-only. No backfill, commit or push is automatic.

Deferred: scheduling, full accuracy scoring/cohort UI, actual booking dates, monthly/fiscal periods, FX, SALES self-history, dashboard integration, weighted/target historical reporting in this new layer, intentional revisions/reruns, retention/export and precise reasons for source scope exits.


## Validation completed October 15, 2026

- Lint and typecheck passed under Node 22.23.3.
- 80 individual unit cases passed across eight relevant files: Forecast Snapshots (11), Opportunity Snapshots (13), forecast (5), Opportunity history (14), dashboard widgets (6), reporting (13), authorization (16), Administration navigation (2). Files were also executed directly so individual assertions and counts were verified.
- All 18 Playwright tests passed across Forecast Snapshots, Opportunity Snapshots, Opportunity, Reports and Admin suites. The new migration, exact source rollups, immutability, atomic insertion, period/currency/owner filtering, concurrent duplicate protection, manual confirmation and role denial were exercised in the dedicated `saleshub_e2e` database.
- Capture, comparison and source drill-through layouts passed overflow assertions at 1440×900 desktop, 768×1024 tablet and 390×844 mobile. Screenshots were saved; desktop, tablet and mobile images were visually reviewed. Screenshot caret hiding was disabled to avoid Playwright-injected styles causing hydration warnings.
- Production `npm run build -- --webpack` passed, including TypeScript and page generation. It ran outside the sandbox after the sandboxed attempt failed to parse child-process TypeScript output. No build settings were changed.
- `git diff --check` passed. Build-generated configuration/agent files were restored or removed by the validation wrappers. No commit, push, production migration or production capture was performed.

Logs and screenshots are saved in the ignored `app/reports/forecast-snapshots/` directory.
