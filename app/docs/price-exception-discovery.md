# Price Exception discovery for Sales

The Products page has a separate Price Exception filter. Its indicator counts distinct Price Exception records with at least one current, visible pricing tier for the Product's active SKU. A current tier has an ACTIVE, unarchived PE; no past expiration date; an active linked Account in one of the PE party roles; an approved price; a positive normalized MOQ; and an unretired line. Sales visibility follows the existing assigned-PE rule. The SKU and Product must also be active.

The Price Exception lookup lists those tiers before an Opportunity exists. Search by linked Account name and SKU or Product name, then verify the exact Account role, SKU, MOQ, currency, and approved price. Each row links to the PE detail and Product. Historical, expired, unresolved, and unpriced records remain available on the existing Price Exceptions history page.

`PE_LIST` remains a SKU catalog-source enum value with explicit template import, manual SKU classification, and existing filter support. The repository has no PE List workbook mapping, but this is not enough evidence that the value is unused in stored data. Keep it as a classification for SKUs explicitly sourced from a PE list; never set it because a PE references a SKU. Remove the Catalog Source option only after a separate inventory of stored `PE_LIST` SKUs and a decision about their replacement classification.

## Expiration follow-up

The stored PE status (`ACTIVE`, `EXPIRED`, or `ARCHIVED`) and expiration state are separate. An **Active but Expired** PE has stored status `ACTIVE` and an expiration date before the current New York business date. Reporting never changes its status. The general Price Exceptions page can combine Status = Active with Expiration = Expired.

The [Expiring Price Exceptions report](/reports/price-exceptions-expiring) defaults to active PEs that expired or expire within 90 calendar days. Next 30, 60, and 90 day filters include today through the selected day, cumulatively. The Dashboard counts use exclusive Expired, 0–30, 31–60, and 61–90 day ranges. The Dashboard and Excel export use the report's shared server-side expiration definitions and PE visibility scope.
### Sales follow-up workflow

Price Exceptions have three separate concepts. **Stored Status** is the source lifecycle value (ACTIVE, EXPIRED, or ARCHIVED). **Expiration State** is calculated from the expiration date and the current New York business date; an ACTIVE PE can therefore be Expired. **Follow-up Status** records Sales work: Not Started, In Progress, Renewal Requested, Replacement Submitted, No Renewal Needed, or Completed.

Expiration answers: “What is true about the PE?” Follow-up answers: “What are we doing about it?” Follow-up edits never change stored PE status or source import data. An untouched PE displays Not Started and defaults its follow-up owner to its assigned Sales Rep without creating a workflow row or history. If the PE has no assigned Sales Rep, it displays Unassigned. A saved follow-up has a current summary and append-only events with actor, time, and before/after values. The optional next follow-up date is a Sales action date, separate from expiration. An existing replacement PE can be linked, or its reference number can be recorded until it exists in SalesHub.
