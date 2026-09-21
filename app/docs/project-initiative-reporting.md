# Project / Initiative reporting

The report starts with unarchived Projects. One Project is represented once in the result data. Its optional Primary Account and participant Accounts remain separate relationships. A Project with no Account or linked Opportunity still appears.

Linked commercial values come from active Opportunity product-line snapshots through `OpportunityProject`. The report does not store Project revenue or divide an Opportunity value among Projects. By default, only open Opportunities contribute to Linked Pipeline and Weighted Pipeline. Commit counts only open Opportunities explicitly marked `COMMIT`; the Project status does not affect Commit. Won Opportunity Value is a separate optional metric for Closed Won Opportunities and does not represent invoiced revenue.

An Opportunity can belong to several Projects. Each Project group may include its full value, while overall Pipeline, Weighted Pipeline, Commit, Won Opportunity Value, and Opportunity Count count each linked Opportunity once. Overall Project Count counts each Project once. Product Category groups use Opportunity membership, so groups can overlap. Drill-down keeps the contributing Opportunity set for each group.

Money is calculated and shown by Opportunity currency, with no conversion. Projects with no qualifying Opportunities retain zero amounts internally and display `—` for currency and monetary cells. Their result currency is `null`, never a placeholder currency code. A Project with Opportunities in multiple currencies has separate currency amounts in the detail table.

Optional detail columns show Product Categories from linked Opportunity product membership and Partner / Channel Accounts from linked Opportunity participants with partner roles. These are context only and do not add monetary value. Account and Opportunity links follow the viewer's existing access.

The Project query uses `projectReadWhere`, plus an unarchived Project condition. The nested Opportunity relationship uses the same `opportunityScope` and filters as Pipeline reporting. Under current rules, SALES can read unarchived Projects, but only their owned Opportunities contribute commercial values. ADMIN, SALES_MANAGER, and READ_ONLY follow their existing broad sales read scope; READ_ONLY may run permitted shared reports but cannot create them. MARKETING_MANAGER cannot run this report. Sharing a saved definition never changes either Project or Opportunity visibility. All related data is loaded by one Prisma Project query; no summary table or migration is needed.

The default open Opportunity view retains Projects with no matching open Opportunities. An explicit Opportunity filter beyond Open (such as Sales Rep, Stage, Product Category, Currency, or Closed Won) selects Projects with at least one matching authorized Opportunity. The Has Linked Opportunities filter tests the existence of active links regardless of the selected Opportunity status.

Project statuses use the current values and labels: Planning, Active, On Hold, Completed, and Cancelled. Overdue Target End Date means before today in America/New_York, excluding Completed and Cancelled. The next 30 days includes today and excludes the day 30 days later.
