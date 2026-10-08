# Support Cases: foundation

Support Cases track customer issues as first-class CRM records. This step adds the data and service layer only; no case pages, navigation, Account/Contact tabs, activity links, notifications, or reports exist yet.

## Data and relationships

A case requires an active Account, subject, description, source, and actor. Contact is optional but, when supplied, must be active and belong to the selected Account. Category, assignee, and Product/SKU are optional. A serial number is plain text; no Asset record or duplicated SKU details are created. `nextFollowUpAt` and other timestamps are stored as UTC instants and will be shown in the user's time zone by a later UI. Core fields are relational rather than JSON.

Categories are Admin-managed lookup rows with unique names, active flags, and sort order. They are not seeded. The backend supports add, rename, activate/deactivate, and reorder. Historical category references remain when a category is deactivated; no delete service exists. Category administration UI is deferred.

## Status, priority, and source

Statuses: New, Open, Waiting on Customer, Waiting on Internal, Resolved, Closed. New can move to any other status. Open and either Waiting state can move among working states, Resolved, or Closed. Resolved can move to Open or Closed. Closed can reopen to Open. Changes are explicit, never time driven. Priority is Low, Normal (default), High, or Critical. Source is Phone, Email, Web, Internal Referral, or Other; Web and Email are recorded context only.

On entering Resolved, `resolvedAt` is set. On entering Closed, `closedAt` is set. Reopening to Open clears current `resolvedAt` and `closedAt`; history retains the previous values and transitions. Closing directly from a working state is allowed. `resolutionSummary` is editable separately. Archive is independent of Closed: archived cases are hidden from normal service reads, retained with history, and restorable. Archived cases must be restored before other edits.

## Numbering and history

A number is assigned once as `BXS-YYYY-NNNNNN`, using the UTC year at creation. A PostgreSQL counter row per year is incremented with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside the case creation transaction. PostgreSQL serializes conflicting updates, so concurrent creation cannot reuse a number. The counter starts at 1 each UTC year and numbers may have gaps if records are removed by exceptional administration or transactions outside this service; normal rollbacks do not consume a committed counter value. The case number has a unique index and a database trigger blocks changes. Historical `SUP-` case numbers remain unchanged and readable.

Creation writes a baseline event and initial non-null field events. Updates write one event per changed core field, with old/new values, actor ID, timestamp, source, and display snapshots for referenced Account, Contact, assignee, category, and SKU. Archive and restore are audited. No-op edits create no events. Event writes and case mutations share a transaction; row locking serializes concurrent updates to the same case. A database trigger blocks event updates and deletes. Services should receive the effective CRM user, consistent with existing development impersonation behavior.

## Access and assignment

All access uses the existing `can` grant table. Support and Admin can create, read, update, archive, and restore all cases. Support is granted read access to Accounts, Contacts, and Products/SKUs, but no Sales Plan, Forecast, Sales Target, Price Exception mutation, Product administration, or general Administration capability. Only active, unarchived Support or Admin users are eligible assignees, via the existing eligibility helper. Support is a team-wide scope: assignment does not restrict editing.

Sales and Sales Manager can read cases only while they retain `accounts.read`; they cannot mutate cases. Read Only and Marketing Manager can also read cases under their existing broad Account read policy and cannot mutate. Current Account detail access is capability based and does not enforce owner or team scoping, so case reads follow that exact existing policy. If Account visibility becomes owner scoped later, `supportCaseReadWhere` must be narrowed at the same time. No case operation exposes an Account to a role lacking `accounts.read`. Only Admin can configure categories.

The services accept an explicit actor and enforce permissions and reference validation server side. No Support route or server action is exposed in this step. Any future route or action must call these services with `currentUser()` and must not trust role, scope, or actor IDs from a request.

## Query indexes

`caseNumber` is unique. `(accountId, openedAt)` supports Account history; `(assignedToId, status)` supports assignee queues; `(status, priority)` supports triage; category and SKU indexes support relational filters; `nextFollowUpAt` supports due work; `archivedAt` supports normal versus archived reads; `(supportCaseId, createdAt, id)` supports ordered history. The category `(active, sortOrder)` index supports configuration options.

## Deferred

Operational pages, Account and Contact tabs, Activity/Task/Note linkage, attachments, dashboards, reports, notifications, ingestion, RMA, SLA, portal, and knowledge base belong to later steps.
