# Pipeline Movement v1

Pipeline Movement is available under Reports and from Quarterly Forecast at
`/reports/pipeline-movement`. It explains captured changes without scoring,
rankings, predictions, recommendations, AI summaries, or changes to attribution.

## Architecture and source

`app/lib/pipeline-movement.ts` is a pure, query-time comparison engine. It accepts
captured endpoints, a reporting period (`start`, `endExclusive`), one currency,
an optional owner, and optional participation/category/stage ordering policies.
It does not read live Opportunities or history events. No movement events are
persisted and no schema migration is required.

`app/lib/pipeline-movement-report.ts` supplies SalesHub policy, validates effective
actor access and filters, selects two existing complete Opportunity Snapshot runs,
retrieves candidate keys matching either endpoint's period/owner/currency, then
loads **both** captured endpoints. The page, table, composition summary and compact
management groups all use that one analysis result. Existing snapshot creation,
immutability, amounts, currencies and attribution are unchanged.

The generic engine does not depend on company names, category labels or calendar
quarters. Categories may be absent; amount, close date, stages and status still
work. SalesHub's adapter supplies calendar-quarter boundaries and the existing
Pipeline / Best Case / Commit inclusion policy. Category labels belong to the
presentation. This does not introduce fiscal calendars, tenancy or configuration
infrastructure.

## Financial reconciliation

For each Opportunity `i`, define `B_i` and `A_i` as the captured amount if that
endpoint qualifies for the selected scope, otherwise zero. Scope means OPEN,
selected period, selected currency, selected captured owner (or team), and the
participation policy. Then:

```
Starting Pipeline = sum(B_i)
Ending Pipeline = sum(A_i)
Pipeline Impact_i = A_i - B_i
Starting Pipeline + sum(Pipeline Impact_i) = Ending Pipeline
```

All arithmetic uses a private Prisma Decimal constructor with 40 significant
digits (without changing global Decimal settings), including sums, deltas, comparisons and
reconciliation assertions. Numbers are formatted using the existing decimal-string currency
formatter only at presentation, preserving cents for large values. Unlike currencies never share a total.

Each Opportunity's **entire** impact is allocated to exactly one bucket:

| Captured membership | Allocation, in precedence order |
| --- | --- |
| Both endpoints qualify | Value Increases / Decreases; zero has no financial bucket |
| Earlier only | Captured later Won; captured later Lost; left selected period; other scope exit/removal |
| Later only | Absent earlier: Additions; entered selected period: Entered Quarter; other scope entry/reopened |
| Neither | No financial allocation; newly captured closures remain visible with zero impact, other rows are excluded |

Scope exits include owner transfers, currency changes, exclusion by category or
captured eligibility, and unknown absence. Scope entries cover the reverse and
reopening. A zero-valued Opportunity can still show attribute changes.

Example: a Q4 $200K deal becomes a Q1 $150K deal and changes Commit to Best Case.
Q4 allocates **-$200K once** to Slipped Out. The $50K decrease and category change
remain in All changes; Value Decreases receives zero from that deal.

Closure uses captured status, even if expected close and amount also changed.
A newly captured Won/Lost deal with no earlier open contribution remains visible
with zero Pipeline Impact; its earlier open value is never invented.
Current Actual Close Dates and Outcome Reasons never rewrite snapshot meaning.

## Primary Movement and other changes

The deterministic primary label is the first detected change in this sequence:

1. Closed Won
2. Closed Lost
3. Slipped out of selected period
4. Entered selected period
5. New Opportunity (newly included, not proof of creation)
6. Removed from active pipeline (absence with unknown reason)
7. Reopened
8. Value decrease, then increase
9. Forecast downgrade, upgrade, then other category change
10. Stage regression, advancement, then other stage change
11. Owner, currency, eligibility, then other captured details

All detected changes survive independently of the primary label. Financial
allocation follows endpoint membership, so it can differ from the primary label.
The expanded table includes the actual reconciliation bucket for each deal.

Stage sort order was not captured. The adapter uses **frozen stage probability**
as a direction proxy when stage IDs differ; equal probabilities show Stage
changed. It never joins current stage configuration. The generic engine also
accepts an explicit stage-order map if future snapshot evidence provides one.
Forecast direction uses the adapter's ordered categories; unranked categories
show Category changed. Missing close dates are outside the selected period;
leaving a quarter includes clearing its date or moving to any other period.

## Forecast composition

Pipeline financial movement and forecast category movement are separate views of
the same endpoint contributions. For each category:

```
Previous + Moved in - Moved out + Retained value change = Current
```

Entry uses the full later value, exit the full earlier value, and retained-deal
movement uses its amount difference. Owner/period/currency/eligibility scope
changes also enter or leave category composition. A $100K Best Case to Commit
transition has $0 pipeline impact, $100K out of Best Case and $100K into Commit.
Each category's equation is asserted by the engine.

The browser fixture independently checks the rendered reconciliation in integer
cents: `875 + 50 + 30 - 5 + 250 - 200 - 80 - 25 - 60 = 835`. Its $200 slipped
deal also drops to $150 and changes category; it contributes only the $200 exit.
The same fixture checks a category-only transfer with zero pipeline impact,
owner/currency/period filters, and newly captured Won with zero invented baseline.


Compact management groups show at most five Opportunities per group. Groups can
overlap and are not additive. The paginated detail table includes unchanged deals
so the complete selected endpoints can be inspected (50 rows per page).

## Defaults, visibility and historical limits

- Latest valid COMPLETE Opportunity Snapshot, compared with the immediately prior
  valid capture by snapshot time. Both known scope versions are supported.
- The quarter defaults from the later snapshot's New York business date.
- Sales defaults to their own ID and can intentionally choose an eligible Sales
  or Sales Manager rep, following shared Opportunity/Pipeline read visibility.
  Sales cannot request team totals. Admins and Sales Managers can choose team or
  an eligible individual. Other roles cannot access this report or Help topic.
- Effective impersonated identity determines authorization and the default owner.
- Eligible selectable reps use the existing active Sales / Sales Manager list.
  Historical participation uses captured owner IDs and eligibility, not current
  user records. This preserves historical attribution if an owner later retires.
- The default currency is captured USD when present, otherwise the first captured
  currency. Selection is required through a single-currency selector.
- The selector lists up to 104 recent valid runs. Explicit older run IDs in links
  are fetched separately, and the immediately prior run is looked up directly.
- No prior capture produces an unavailable state, never a fabricated zero change.
  Invalid, equal, reversed or incompatible run IDs produce a clear resettable error.
- Legacy OPEN_OPERATIONAL_V1 captures lack owner eligibility and closure evidence.
  Null eligibility is included as captured and explicitly disclosed. Explicitly
  false eligibility is excluded. A comparison with legacy rows need not match a
  Forecast Snapshot rollup, which requires known true eligibility.
- Current FORECAST_OPERATIONAL_V1 capture contains OPEN and WON, excluding LOST.
  Absence cannot distinguish Lost, archived or other operational scope removal.
  It is reported as Removed with reason not recorded. Captured LOST endpoints are
  supported by the existing schema and engine, but normal weekly runs cannot
  provide them today. No current live status is substituted.
- Actual Close and structured outcomes remain available in existing Opportunity
  workflows for later actual-results work. This report adds no accuracy analysis.

## Help and changed files

The contextual Pipeline Movement Help topic explains selection, reconciliation,
slips/entries, amount changes, closures/unknown removal, composition and drill-in.
Forecasting Help now distinguishes Pipeline Movement access from management-only
Opportunity / Forecast Snapshot History.

Implementation files:

- `app/lib/pipeline-movement.ts` — generic comparison, decimal reconciliation,
  classifications, category composition and shared management group result.
- `app/lib/pipeline-movement-report.ts` — snapshot selection, bounded read adapter,
  participation policy, eligible rep validation, defaults and authorization.
- `app/app/reports/pipeline-movement/page.tsx` — report and responsive detail view.
- `app/app/reports/page.tsx`, `app/app/reports/forecast/page.tsx` — entry links.
- `app/lib/authorization.ts` — effective-role route guard.
- `app/lib/help/topics.ts` — contextual Help and forecasting access clarification.
- `app/tests/pipeline-movement.test.mjs` — financial, attribute and service tests.
- `app/e2e/pipeline-movement.spec.ts` — database and browser checks.
- `docs/pipeline-movement.md` — design, correctness and operational limits.

## Performance

At existing limits each run has at most 10,000 rows, so comparison reads at most
20,000 captured endpoints. Candidate selection uses only two run IDs with the
existing run/close-date/currency and owner/run indexes, and retrieves both states
using the existing unique run/Opportunity key. Unknown larger runs are refused,
never silently truncated. No whole-history row scan, new index, materialized event
store or cache is introduced. Metadata selection is bounded, and only the two
selected runs are used for currency discovery and analysis.

The engine is O(n) for detection/aggregation and O(n log n) for sorting financial
movement groups, with O(n) memory. The UI renders only 50 detail rows. Queries need
no transaction for immutable completed runs; read statements see the same frozen
values. Newly captured runs do not alter the selected comparison.

Reassess request-local memoization or bounded caching keyed by run IDs, period,
owner, currency and policy version if measured p95 comparison compute/query time
exceeds 1 second, report latency exceeds 2 seconds under expected concurrency, or
the 10,000-row capture limit must grow. Benchmark before introducing persistent
precomputation. Those are investigation thresholds, not measured current limits.

## Validation

Validated using the project's supported Node 22 runtime (22.23.3):

- `npm run lint`: passed, with no warnings.
- `npm run typecheck`: passed after restoring the original generated-file setup.
- Production build, `npm run build -- --webpack`: passed; the report is a dynamic
  server route. The build used the isolated E2E database URL.
- 76 focused unit and forecast/snapshot/weekly/Help regression tests: passed.
  Coverage includes thousands of combined endpoint transitions, single-cent
  changes on 10,000 maximum-size amounts, missing prior (including old captures),
  manual/automated and legacy sources, effective roles and owner selection.
- 16 existing Opportunity / Forecast / weekly snapshot Playwright regressions:
  passed, including capture, immutability, permissions, attribution and layouts.
- Final Pipeline Movement and Help Playwright suites: 22 passed, zero skipped.
  Coverage includes latest/prior defaults, snapshot changes, owner/quarter/currency
  filters, rendered integer-cent reconciliation, detail expansion, management
  groups, Help navigation, Sales cross-rep viewing and actual impersonation.
- Desktop 1440px, tablet 768px and mobile 390px report checks: passed. Detail and
  category tables scroll within their containers without page overflow. Help also
  passed 1024px layout and keyboard checks. Screenshots were visually reviewed.
- `git diff --check` and whitespace/final-newline checks for new files: passed.

The synthetic 10,000-paired-row cent-precision unit case took approximately 0.76s
in this validation environment. This is not a production latency measurement;
request thresholds above still require real workload measurement if reached.

Browser fixtures use only the isolated saleshub-e2e database. No production data
or infrastructure was changed, and no commit, push or deployment was performed.
No migrations were added or modified. Next-generated environment, configuration
and instruction-file changes were removed from the final working diff.

Business-policy follow-ups for later scope: whether snapshots should capture Lost
and actual stage ordering, and whether legacy unknown eligibility should be
excluded in a future strict historical forecast mode. v1 reports their limits
explicitly and does not require a migration or a policy decision to reconcile.

## Historical trends and outcomes

Pipeline Movement v2 extends this comparison at
`/reports/pipeline-movement/history`. See [the v2 design and rules](pipeline-movement-v2.md).
The v1 engine and its one-delta-per-Opportunity reconciliation are unchanged.
