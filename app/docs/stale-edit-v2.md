# Shared editor stale-edit audit (v2)

This inventory covers interactive edits that can replace another user's saved fields or relationships. It is intentionally scoped to shared CRM records rather than every table with `updatedAt`.

## Protection present before v2

| Editor | Existing protection |
| --- | --- |
| Accounts, Contacts | Form token and conditional save; Contact relationship and primary transfers are transactional. |
| Opportunities, Projects | Form token and conditional parent claim before participant, product, contact, and Project link changes. |
| Tasks, Support Cases, Activities, editable Notes | Form token and conditional update; entered values and record-changed notice in the editor. |
| Trade Show individual leads | Form token and conditional update; bulk routing checks submitted row versions. |
| Price Exception reference corrections | Form token and conditional parent claim before related correction. |
| Demo operational owner | Conditional `DemoRequest.updatedAt` update, including the maintenance event in its transaction. |

## Candidate assessment and v2 decision

| Candidate | Shared-edit risk | Observed editing pattern and decision |
| --- | --- | --- |
| Project Updates | Moderate | Existing entries have an Edit control for body and optional Opportunity link. Protected; creation remains append-only. |
| Opportunity Updates | Moderate | Same `ProjectUpdate` editor can change body and optional Project link. Protected without changing authorship history. |
| Marketing Campaigns | High | Marketing Manager and Admin edit name, dates, status, details and archive state. Protected editable fields and archive action. Attribution touches are separate append-only or voiding workflows. |
| Marketing Audiences | High for shared; low for personal | Marketing/Admin edit filters, metadata, visibility, and manual Contact overrides. Protected both definition and override transactions using the parent version. Personal audiences use the same path. Ownership recovery was already a conditional update. |
| Demo records | High | Sales owners and managers edit notes, business links, return estimate and unit state; Admin can reassign operational owner. Protected those actions with the Demo version. Import revisions and requester/reviewer/shipper provenance remain historical. |
| Product and SKU metadata | High | Admin/Sales operations edit model name, category, part number, status, descriptive and ODM relationship fields. Protected Product and SKU updates; SKU edits also advance and claim the Product version. Historical imported prices have no manual edit form. |
| Trade Show event setup | High | Marketing/Admin edit event details, timezone, owner, booth and resource links together. Protected the parent and resource-link transaction. Per-lead routing already has row-version protection. |
| Saved Report definitions | Moderate for shared; low for personal | Owner/authorized editor can change title, visibility and validated configuration. Protected both through the same save path; execution remains read-only. Ownership recovery was already conditional. |

## Mutation contract

Edit forms carry the server-supplied `updatedAt` token. Actions check module availability and authorization, validate the token with `app/lib/stale-edit.ts`, then update with `id` plus `updatedAt` in the `where` clause. Successful writes use `nextUpdatedAt`, including rapid successive saves. Project Updates, Trade Show links, SKU customer relationships and pricing terms, Audience overrides, and Demo unit state perform the claim in the same transaction as related mutations. A stale claim rolls back every related write. The existing `RecordChangedNotice` tells the user to review the latest record; forms retain entered values and do not merge.

The v2 code adds no schema fields or migrations. It retains Node 22.23.4 and Prisma 6.19.3.

## Remaining last-write-wins or discrete workflows

| Surface | Reason for leaving it outside the shared-editor token pattern |
| --- | --- |
| Demo source revisions, requester/reviewer/shipper provenance, return-event history | Revision and return-event rows are append-only. The reviewed import can replace source-managed fields on the Demo parent and advances its `updatedAt`; there is no interactive editor for an existing history row. Demo unit return/deployment actions claim the parent version. |
| Demo linking from a Project or Opportunity picker | A discrete link-into-empty-slot action. Its conditional `projectId: null` or `opportunityId: null` update prevents two competing links; it does not replace notes or ownership. |
| Trade Show and saved Report archive/reactivate buttons | Discrete lifecycle actions, not multi-field edit forms. They condition on current `updatedAt` and current archive state to close the read/write race, but do not carry the original page token. They can act on a record whose unrelated details changed after page load. |
| Product import/batch classification and imported catalog or pricing history | Reviewed batch/import workflow, not an open interactive metadata form. Live catalog, SKU, customer-link and price changes advance Product/SKU versions so waiting metadata forms reject stale saves; imported price revisions remain historical. |
| Generated Audience membership, export files and Report results | Computed from current data; no mutable definition is saved by execution or export. |
| Personal Saved Views and user Dashboard layouts/preferences | Owner-scoped single-user configuration, with negligible cross-user overwrite risk. Multi-tab last-write-wins remains possible. |
| Admin user profile, role and active-state editor | Restricted administrator workflow, edited infrequently; simultaneous administrator changes to the same user can still replace one another. Identity reset and user import are separate actions. |
| Lead Source options, Sales Stages, competitors, lookup lists, outcome reasons and support categories | Low-frequency reference-data editors with narrow permissions. Lead Source options allow Marketing Manager and Admin; the others use administrator configuration permissions. Concurrent authorized edits to the same row can still overwrite. Sales Stage forecast recalculation already runs transactionally. |
| Currency configuration, sales targets, trusted and internal email domains | Narrow administrator setup controls, usually changed by one operator. Simultaneous changes to the same item can still be last-write-wins. |
| Module visibility, system settings, company branding, custom labels and role Dashboard defaults | Low-frequency administrator configuration. The module visibility gate is enforced at mutation time for the protected editors above; the configuration controls themselves remain last-write-wins. |
| Global import mapping templates | Administrator batch configuration with negligible live shared-edit risk. Import execution remains a separate reviewed workflow. |
| Other event-based maintenance and integration transitions | Append-only or dedicated state-machine/conditional workflows; they do not expose a shared multi-field edit form in the candidate families above. |

This list is the intentional residual backlog for interactive editors. It should be revisited if ownership or editing frequency changes, especially for global admin settings.
