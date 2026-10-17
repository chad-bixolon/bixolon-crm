# Opportunity Snapshots v1

An Opportunity Snapshot is an immutable copy of the pipeline at an actual capture time. It supports weekly comparisons without changing Opportunity saves, product pricing, pipeline calculations, forecasting, or existing change history. Live Opportunities remain the source of truth. Weekly automation is available through the shared services; production scheduling is configured separately. See [Weekly Snapshot Automation](weekly-snapshot-automation.md).

## Inspection and field meanings

The live Opportunity has no stored amount. Estimated value is the sum of `quantity × estimatedUnitPrice` for unarchived Opportunity Product lines, calculated using decimal arithmetic. Product count means active product **line count**, not distinct products or units. Snapshot `amount` is also total product value; a second identical value column is unnecessary. Currency is preserved, and different currencies are never added together or interpreted as increases/decreases.

Probability is an Opportunity override when non-null, otherwise the stage probability. Capture stores the effective probability, nullable override, and stage probability so later stage defaults cannot rewrite historical meaning. Forecast category is the existing `ForecastCategory` enum. Status comes from the stage flags: open, won, or lost. Under v1's open-only inclusion rule captured status is always `OPEN`.

Accounts are many-to-many participants, with no authoritative primary Account. Each row stores all participant IDs in an indexed integer array and compact `{id, name}` pairs in JSON. It never selects an arbitrary “main” customer or uses the legacy Account column as the reporting relationship. No Account roles or full related objects are copied.

Capture includes:

| Context | Preserved fields |
| --- | --- |
| Run | ID, actual snapshot timestamp, New York Monday week key, creator ID/name, Opportunity count, complete status, source, scope version, creation time |
| Opportunity | ID and name |
| Accounts | All participant IDs and names |
| Salesperson | Nullable owner ID and name; null means unassigned |
| Stage | ID and name |
| Value | Estimated amount, currency, active product-line count |
| Close | Nullable expected close date |
| Probability | Effective value, nullable override, stage default |
| Forecast/status | Existing category and stage-derived status |

IDs describing historical live entities deliberately have no foreign keys to mutable live records. Snapshots can still be understood if a live entity is renamed, archived or deleted. Only each row's run relationship has a restrictive foreign key.

Existing `OpportunityHistoryEvent` and its archive record selected changes and baselines. `ForecastSnapshot` and its archive preserve weekly **aggregate** rep/quarter/currency metrics. Dashboard forecast movement and existing forecast reports use those structures. They cannot reconstruct complete Opportunity-level sets at arbitrary past dates, and are unchanged by this implementation. Snapshot history starts with the first manual capture; there is no backfill or invented prehistory.

## Forecast-ready extension

Forecast Snapshots v1 adds an explicit forecast-ready option to this same shared capture service. The default open-only rules below remain available. Forecast-ready scope (`FORECAST_OPERATIONAL_V1`) captures open plus Closed Won Opportunities with the same operational filters and freezes `ownerForecastEligible` for every row. Closed Won uses stage status, and Expected Close Date assigns its forecast quarter. One run per week still applies across both scopes; choose the scope before capture. Older runs are immutable and cannot supply the missing eligibility/outcomes. Source-linked `ForecastSnapshotRun` / `ForecastSnapshotRollup` records derive only from compatible forecast-ready runs. See [Forecast Snapshots](forecast-snapshots.md) for exact category/period/currency rules, manual confirmation, permissions, drill-through, storage and accuracy limitations. The legacy aggregate `ForecastSnapshot` table remains unchanged.

The Opportunity comparison now also shows captured status/owner-eligibility changes and accepts period, currency and forecast-category drill-through filters. Those filters match either endpoint and preserve both values; absent endpoints still have unknown scope exit reasons.

## Exact inclusion rules

Scope version: `OPEN_OPERATIONAL_V1`.

- Opportunity is unarchived and its stage has `isClosed = false`.
- Reuse the existing `operationalOpportunityWhere`: a linked legacy Account and every participating Account must be active and unarchived; every linked Project must be operational (unarchived, with active/unarchived linked Accounts).
- Include all currencies, owners (including unassigned/inactive owners), open stages (including inactive stage definitions), probabilities, and forecast categories, including `OMITTED`. Missing close dates and zero/no product values remain included.
- Exclude every closed Opportunity, archived Opportunity, and Opportunity excluded by those operational relationship rules. Recently closed copies are deferred.
- There is no test-data flag. Known test records must be archived through the existing CRM process before preview. Names containing “test” or “demo” are not enough to infer synthetic data; no keyword exclusion is applied. A legitimate product demonstration must not silently disappear.

The preview shows the eligible count. Runs are all-or-nothing, including a valid empty run. Above 10,000 eligible Opportunities the service refuses capture with a visible error; it never silently truncates a set. Raise that limit only after reviewing transaction duration, storage and queries.

## Manual process and integrity

1. An ADMIN opens Administration → Opportunity Snapshots.
2. Select **Preview snapshot**. The server reads a consistent set and returns its count, preview time in UTC, and New York week starting date. A signed, user-bound token contains a fingerprint of the captured fields and expires after 15 minutes.
3. Review the scope/count and check the explicit confirmation box.
4. Select **Confirm snapshot**. The server reads a fresh consistent set. Any captured-field change, count change, expiry or week rollover requires a new preview. No partial run is saved.
5. Success reports the actual capture time, row count and run ID. Review it in Reports → Opportunity Snapshot History.

Preview time is not snapshot time. Snapshot time is the database transaction timestamp at actual capture, paired with a PostgreSQL Repeatable Read snapshot. Related queries and product aggregates use the same consistent database view. Inserts are chunked into 500 rows inside that same transaction. A process failure rolls back the entire run. `COMPLETE` is the only committed status; incomplete/failed attempts leave no reporting run.

One unique run is allowed per Monday–Sunday America/New_York week, including daylight saving boundaries. Concurrent confirmations cannot create duplicate weeks. v1 disables backdating, replacement and intentional reruns; a later rerun feature would need explicit revision semantics and a new schema migration.

Database triggers reject updates, deletes and truncation of both tables. Rows must share the parent's timestamp and be inserted in the transaction that created the parent. A deferred constraint trigger verifies the complete row count at commit. The application exposes no edit/delete/append operation. The existing history retention/archive tool does not alter these tables.

## Reporting and permissions

Manual capture is ADMIN-only. Team snapshot reports are ADMIN and SALES_MANAGER-only, with route and server-service checks. No role gains live Opportunity access.

Opportunity detail adds a compact latest-eight Snapshot History section for ADMIN, SALES_MANAGER and SALES. SALES must currently own the live Opportunity, and each returned historical snapshot must also have that salesperson as owner. Previous-owner or reassigned-away histories do not leak through detail. Other roles receive no snapshot section. SALES do not gain the team report.

The dedicated report supports an earlier/later run, UTC run-date window, salesperson, stage and participating Account filters. It uses preserved historical display names, never mutable joins for reporting. The default picker lists up to 104 latest runs; use the date window to find older periods. Historical filter choices are bounded to 201 entries per field. Rows are paged on the server, at 50 Opportunities per page; both endpoints are fetched together in a single bounded query. Full-result pipeline totals are grouped by run and currency, independently of pagination. Filters match all selected conditions on either endpoint, then retain both endpoints; changing owner or stage is not misreported as disappearance from a filtered cohort.

Interpretation:

- Compare stage **IDs** for stage movement; a label change with the same ID is “Stage renamed.”
- Compare decimal amounts only in the same currency. A currency change is explicitly non-comparable.
- “Close date slipped” means both close dates exist and the later snapshot has a later calendar date. Earlier means “pulled in.” Added/cleared dates have separate labels. Time-of-day changes on the same calendar date do not count.
- Owner, forecast category and effective probability changes are identified separately.
- A new endpoint is “Entered snapshot set,” which may mean new, restored or newly eligible. It does not assert a creation event.
- An absent endpoint is “Left snapshot scope — closure/removal reason not captured.” A close, archive or Account/Project scope change can cause this. v1 deliberately does not infer won/lost, closure date, or a loss amount from absence or from today's live state.
- Forecast-category changes are shown directly. A particular quarterly forecast also depends on expected-close period, owner eligibility and currency. Category changes alone are not labeled “entered/left forecast.” The preserved values support future period-aware reporting without inventing that meaning now.

## Storage and deferred work

Read-only production inventory on October 15, 2026: **7 total Opportunities, 6 eligible open, 1 archived**. At a steady six eligible deals, 52 weekly captures produce **312 snapshot rows and 52 run rows per year**. General growth is `52 × average eligible open Opportunity count`; 1,000 open deals means 52,000 rows/year. Display-name lengths and Account participant counts affect byte size; this is a row estimate, not a measured disk budget. No notes, descriptions, attachments, product rows, pricing provenance, contacts or large texts are copied.

Deferred: intentional revisions/reruns; retention/export; Closed Lost capture and precise exit reasons; primary Account; realized revenue; actual closing date; detailed product snapshots. The forecast-ready extension supplies Closed Won capture and period-aware entry/exit labels; missing source endpoints still have unknown reasons. There is no automatic retention deletion.

Weekly automation reuses the shared preview/capture service with explicit system attribution and durable execution history. See [Weekly Snapshot Automation](weekly-snapshot-automation.md) for cadence, forecast scope/quarter rules, manual reuse, retries, failure recovery, production configuration and troubleshooting. Manual capture and all immutable/unique-week protections remain available.

## Validation

Unit coverage checks field capture, immutable copied values, override/default semantics, stale/expired and signed previews, duplicate weeks, permission denial, movement interpretation, New York week boundaries, and salesperson detail scope. Isolated-database Playwright coverage checks atomic capture, inclusion/exclusion, database immutability and complete-run constraints, historical filters, entries/exits, detail history, access denial, and 1440px desktop / 768px tablet / 390px phone layouts. Tests and migrations run against `saleshub_e2e`, not production.

Migration: `app/prisma/migrations/20261015120000_opportunity_snapshots/migration.sql`. Apply through the normal forward-only production migration process after review, regenerate the runtime Prisma client, then enable use of the new capture/report pages. The existing Opportunity detail tolerates a missing snapshot delegate/table during this staged rollout; unrelated database errors still surface. No production migration or snapshot capture is performed as part of implementing v1.

Completed validation on October 15, 2026: lint and typecheck passed; seven relevant unit-test files passed, including 11 direct snapshot unit cases; all 11 Playwright tests across snapshot, Opportunity, report and Admin suites passed. Snapshot rendering was checked at 1440×900, 768×1024 and 390×844, including overflow assertions and screenshots. The migration and immutable/atomic-run database constraints were exercised in the isolated E2E database. The final Node 22 production build passed with `npm run build -- --webpack`; the default Turbopack build encountered an environment worker-port restriction. `git diff --check` passed. Build logs and screenshots are under the ignored `app/reports/opportunity-snapshots/` directory.
