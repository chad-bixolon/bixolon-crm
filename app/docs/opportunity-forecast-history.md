# Opportunity and forecast history

Opportunity history records meaningful changes to the existing SalesHub forecast inputs. Current Opportunity and SalesTarget data remains authoritative. History does not recalculate or change forecast formulas.

## Capture

Opportunity saves write structured events in the same PostgreSQL transaction as the business edit. Creation writes a `BASELINE` event showing the initial captured state. This is not a claim about earlier history. Updates record separate stage, category, close date, owner, probability override, currency, and total value events only when values change. The total value event compares active product-line totals before and after the entire save, so quantity, unit price, price source, add, and remove changes produce at most one value event per save. Stage closed/won setting changes that alter Opportunity categories are also recorded. Archive and reactivation produce status events.

Events preserve the effective actor ID and display name, Opportunity name, first participating Account name, old and new business values, and occurrence time. Events are immutable through the application. Name snapshots keep archived history legible after live records or users change. The event table does not store full Opportunity documents or files.

Current stage age starts at the latest stage-change or initial baseline event. Existing Opportunities without a stage event show unknown age; updatedAt is never used as a substitute. Close-date movement is recorded as old/new dates. Quarter and year movement can be derived from those dates; no historical dates are fabricated.

## Forecast snapshots

The Admin Opportunity History page captures a New York calendar week (Monday start) for a selected year, quarter, and currency. One row per active sales rep and scope is stored; the unique key prevents duplicate weekly captures. Capture invokes `forecastForRep`, the same service as the current forecast report, and stores Pipeline, Weighted Pipeline, Best Case, Commit, target, and target status as decimals. The first capture is the first baseline. Historical weeks before capture are unavailable. The Admin operation should be run once a week until a scheduler is established; there is no implicit cron dependency. Weekly snapshots freeze the first capture and do not overwrite it on retry.

Forecast Movement compares two captured weeks. With no snapshots it explains that the first capture is needed; with one week it asks for a later capture. Archived snapshots and events are excluded by default and can be included explicitly with the report filter. The aggregate table uses snapshots. The bounded event list shows recorded changes in the interval and is explanatory, not a mathematical attribution of every aggregate dollar. Stage/category filters apply to event explanations only. Team totals sum rep snapshots. Target absence and partial target configuration should be interpreted using the individual snapshot target statuses; the movement table shows a numeric sum of configured targets.

## Retention and access

Active history retention defaults to three years and is configurable from two to ten years. History older than the retention period is *eligible* for archive. Changing the setting does not move or delete rows. No automatic archive or purge runs. Admins preview eligible counts and date ranges, then explicitly move up to 500 events and 500 snapshots per transaction to dedicated archive tables. Each archived row preserves its original source ID, business fields, display snapshots, archive time, and batch ID. A copy-count mismatch or delete-count mismatch rolls back the batch. No hard deletion of historical information is offered.

Admin recovery is available from the same page by archive batch ID. Restore checks active ID and snapshot-scope conflicts, then copies original business rows and IDs back and removes their archive copies in one transaction. A conflict or count mismatch rolls back the entire batch, leaving it archived. Restored rows remain readable through normal history/report views. The archive batch metadata is present while rows are archived; restoring returns those rows to active storage. Archived records also remain directly readable through Opportunity detail history and the explicitly selected historical Forecast Movement view without restoring them.

Opportunity detail history follows current Opportunity visibility: Sales sees owned Opportunities, while Sales Manager, Admin, and Read Only use their existing sales read scope. Marketing receives no new access. Archived Opportunity events remain visible on the same detail page under that scope. Only Admin can capture snapshots or archive. Impersonation uses the effective user from the existing current-user service.

Indexes support Opportunity/time pagination, actor/time, event type/time, date/category searches, and snapshot period/rep/week lookups. Each field change uses a small structured row; snapshot storage grows by approximately active rep count × captured weeks × selected quarter/currency scopes. At this SalesHub scale, that is far smaller than storing full Opportunity JSON on each edit. The Dashboard has no new movement widget in this first release; later analytics can use these events and snapshots.

## Operational note

Deploy the migration before running code that writes history. Do not backfill fictional Opportunity events. A future scheduled job can call the capture service with the same unique weekly key. A future report can add a complete event-level bridge between snapshot totals after defining attribution for simultaneous edits, ownership changes, and forecast eligibility changes.
