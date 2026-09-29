# Rosa Demo Request CSV import

The authoritative development fixture is `reference-data/demo-requests-2026-09-28.csv`. Its 8 rows contain 6 Request IDs. Request ID is the immutable source identity; Demo Number is a display value and may be blank. The two two-line requests are `15110d56-5378-4e00-a8a4-cde6c304ed90` (PAR) and `29d044bd-b332-48b8-994d-2d92771ad01b` (UPS). There are 4 shipped and 2 approved requests, 4 blank Demo Numbers, and no grouped header conflicts. No pending request appears in this fixture.

| Source field | CRM destination |
| --- | --- |
| Request ID | `DemoRequest.sourceRequestId`, unique UUID source key |
| Demo Number | `DemoRequest.demoNumber`; CRM pages show `Pending Demo` when blank |
| Status | `DemoRequest.status`: pending, approved, shipped |
| Requested At / Requested By | `requestedAt` / `requestedById` → eligible `User` |
| Reviewed At / Reviewed By | `reviewedAt` / optional `reviewedById` → eligible `User` when deterministically matched; original Reviewed By remains in source provenance |
| VAR | Customer / Account receiving the Demo equipment → `accountId` on an active `Account`, regardless of business role |
| Shipping Address | `shippingAddress` |
| Shipping Carrier | `shippingCarrier` |
| Carrier Account Number | `carrierAccountNumber` |
| SKU / Model | `DemoItem.sourceSku`, `productSkuId` → active `ProductSku` |
| Quantity | `DemoItem.quantity` |
| Serial Numbers | `DemoItem.serialNumbers` JSON list |
| Tracking Numbers | `DemoItem.trackingNumbers` JSON list |
| Inventory Locations | `DemoItem.inventoryLocations` JSON list |
| Shipped At / Shipped By | `shippedAt` / optional `shippedById` → eligible `User` when deterministically matched; original Shipped By remains in source provenance |
| Duration Value / Duration Unit | `durationValue` / singular normalized `durationUnit` |
| Notes | `notes` |
| Approval Comments | `approvalComments` |

Every raw source field, including the original semicolon-delimited strings and source row numbers, is retained in an append-only `DemoSourceRevision`. The revision also records the source filename, content digest, reviewed CRM mappings, resolved values, source lifecycle timestamp, applying Admin, and application time. PostgreSQL blocks revision updates and deletes. Changed item lines are retired, not deleted; revisions retain the prior item values.

Rosa names the source customer column `VAR`, but Demo equipment may go to an end customer, VAR, distributor, partner, or another Account. CRM presents this value as the Customer or Customer Account receiving the Demo and resolves it to a CRM Account regardless of that Account's business role. The original `VAR` column name and value remain in CSV parsing and source revision evidence. Creating an Account from the Demo preview does not assign a business role unless the Admin selects one.

Preview is read-only. The Admin must resolve ambiguous or missing Account, Requested By User, and SKU matches and grouped header conflicts. Reviewed By and Shipped By are source provenance: unmatched or ambiguous names do not require CRM user mappings or block import. Deterministic matches still populate `reviewedById` and `shippedById`. A Customer Account that cannot be found appears directly in the preview with an existing Account picker and inline Account creation. Creation uses the shared guarded Account validation and duplicate review, including normalized name, website domain, and entered address signals. Possible matches can be selected; creating anyway requires explicit review. Creation adds the Account immediately, updates the current preview without another upload, and leaves Demo application pending. One reviewed Account selection applies to all matching source customer names in the upload, while each Source Request ID remains a separate Demo Request. Original `VAR` text stays in source revision rows and the selected Account ID stays in reviewed mappings. Exact normalized active Account names, full or unique first-name users, and exact active SKU part numbers resolve automatically. Blank optional reviewer or shipper fields require no mapping.

For an unresolved source SKU, an Admin can select an existing active SKU, add a new SKU beneath an existing active Product, or create a Product with its initial SKU within the current preview. Catalog creation uses the normal Product and SKU validators, including normalized part-number uniqueness and ODM-specific rules. The Admin explicitly chooses a Catalog Source, including Unclassified when appropriate; the Demo source does not imply ODM. Likely Product families are shown before creation, and creating a new Product with a likely match requires review. A SKU selection or creation maps the same normalized source SKU across all Demo Requests in the upload and immediately refreshes readiness. Catalog creation writes the Product/SKU at that point, while Demo application remains separately confirmed. Original source SKU text and row values stay in the append-only source revision; the CRM SKU ID is reviewed mapping metadata.

Apply requires a fresh preview digest and explicit confirmation. Each source update also needs its own approval checkbox. Apply replans under a single serializable database transaction, so a failed item prevents all requests in the batch from writing. Identical submissions write nothing. Older submissions cannot regress status or source timestamp. Request ID uniqueness prevents duplicate imported headers. The Demo Request, Item, Unit, Return Event, and Source Revision tables are new because this checkout had no Demo schema or workflow before this change; Accounts, Users, and ProductSkus are reused.

Every Demo has a required Account. Project and Opportunity links are optional CRM context, selected later from Account-compatible records. Account → Demos is the normal Sales workflow; Project and Opportunity pages also show explicitly linked Demos. Linking and unlinking retain the same Demo, items, and source revisions. CRM cannot originate a Demo Request. Admins may backfill an existing Rosa Demo from Administration → Imports → Demo Requests when CSV import is unavailable or missed. Backfill requires the Rosa Request ID, records manual provenance and source values, and uses the same Demo lifecycle and reporting. Account-only Demos are valid.

The standalone `/demos` directory and Administration → Imports → Demo Requests are Admin-only. Sales and Read Only users reach permitted Demo details from Account, Project, or Opportunity context. Sales can edit only their own Demo notes and context; Sales Managers and Admins may edit any under their usual permissions. Read Only cannot edit.

The read-only local Compose preview can be run with `docker compose exec -T app node scripts/operations/preview-demo-local.cjs < reference-data/demo-requests-2026-09-28.csv`. It reads local Demo, Account, User, and SKU records and does not write any Demo records.

## Physical deployment and reporting

A `DemoRequest` is the business request, owned by a required Account. `DemoItem` is a requested SKU and source quantity. `DemoUnit` is one logical physical unit: one row is created for each requested quantity even before a serial is known. Source serials later fill existing blank unit slots. Unit count stays equal to the requested quantity. Source shipment sets unit deployment; source serial, location, tracking, and original rows remain in item fields and immutable revisions. A source import never changes a CRM-recorded returned unit back to deployed.

An **Open Demo** has at least one deployed unit without a return date. Approved or requested units are not deployed inventory. A partial return closes only the selected units; the request stays open until all deployed units return. Authorized users record a date, optional tracking, and note for each returned unit. `DemoReturnEvent` keeps that CRM operational evidence and actor apart from Rosa source revisions. This version treats each logical unit as a single deployment and return cycle; later redeployment requires a dedicated history model and is not offered by the current UI.

The calculated expected return is the source shipped date plus source duration in days, weeks, or calendar months (clamped to the last day of a shorter month). Authorized users may set an effective date override; the calculated date and source duration remain available, and the override stores actor, time, and reason. An outstanding Demo is overdue when its effective expected return calendar date is before today. Days deployed is derived from deployment to today, or deployment to return for a returned unit.

The [Demo Inventory / Deployment report](/reports/demo-inventory) is available from Reports, including to Sales under scoped Demo visibility. It shows logical units, quantities, overdue and recovery attention, and uses the linked Opportunity's current stage for Open/Won/Lost association. A Won Opportunity does not close equipment, and a Lost Opportunity does not trigger a return. Recovery attention is derived for outstanding units when overdue, linked to a Lost Opportunity, or linked to a completed, cancelled, or archived Project. Account-only Demos participate fully, including overdue recovery attention. Project status uses existing Planning, Active, On Hold, Completed, and Cancelled states. The current product catalog has selling prices but no authoritative cost, so Demo value is unavailable.
