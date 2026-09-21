# Quarterly forecast and sales targets

SalesHub uses calendar quarters in the America/New_York business calendar. Expected Close Date assigns an Opportunity to a quarter; date-only values are stored at noon UTC, so the query uses an inclusive UTC first day and exclusive UTC first day of the next quarter. Created date does not assign forecast membership.

An active quarterly Sales Target belongs to one sales rep, year, quarter, and currency. Archived targets remain for planning history and allow a replacement active target. A target is compared only with Opportunities in its own currency. SalesHub performs no FX conversion.

Open Opportunities in PIPELINE, BEST_CASE, and COMMIT categories make up Pipeline. OMITTED and closed Opportunities contribute nothing to open Pipeline. Opportunity value is the sum of unarchived product quantity times estimated unit price. Weighted Pipeline applies the Opportunity probability override, or the Sales Stage probability if no override exists, to that same population. Commit and Best Case are unweighted sums of their respective explicit categories. Stage never implies Commit.

Pipeline Coverage = Pipeline / Target. Weighted Coverage = Weighted Pipeline / Target. Commit Coverage = Commit / Target. A missing or zero target makes all coverage ratios unavailable. Ratios are calculated when requested and rounded to two decimal places for display; no forecast totals or ratios are stored.

The Quarterly Forecast report calls the shared forecast service. A current report for a prior quarter reflects **current CRM state** for Opportunities whose present Expected Close Date falls in that quarter. It is not a snapshot of what management expected on an earlier date. Historical forecast snapshots, fiscal calendars, FX conversion, quota planning, and dashboard widgets are outside this foundation.
