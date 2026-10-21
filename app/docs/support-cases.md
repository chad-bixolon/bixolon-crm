# Support Cases

Support Cases track customer issues as first-class CRM records. The **Support Cases** item under **Support** opens `/support/cases`. Support and Admin can create and manage cases. Sales, Sales Manager, Read Only, and Marketing Manager can read cases under the existing Account read policy but have no case mutation controls. Step 1 grants do not change. Support is a team-wide scope; assignment does not restrict editing. Current Account detail access is capability based and does not enforce owner or team scope, so case reads follow that policy.

## Operational pages

The list shows current cases by default, working statuses first and newest opened within each status, with 20 cases per page. Archived cases are hidden unless **Archived** or **All** is selected. Filters are server-side and combine: Support Rep, status, priority, Account name, category, Product/SKU part number, opened date range, and search. Search covers case number, Account name, Contact first or last name and email, subject, and serial number. Sort choices are current statuses first, newest/oldest opened, priority (Critical first), next follow-up, case number, and recently updated. Pagination retains filters and sort. Opened date bounds use UTC calendar dates.

Create requires either a Customer / End User name as reported to Support or a linked CRM Account, plus subject, description, and source. The raw `customerNameText` is preserved independently when an Account is linked later; no Account is created automatically. Contact remains optional and is scoped to a linked Account. Unlinked cases remain visible to Support and Admin; other read-only case viewers see linked cases according to the existing Account policy. Category, eligible assignee, active SKU, serial number, and follow-up are optional. The Product / SKU search requires selection from suggestions when text is entered; typed text alone never binds an SKU. Failed validation retains entered values and picker selections. Status defaults to New, priority to Normal, and an eligible current user is preselected as assignee. Support Cases may be created directly as Resolved or Closed when the customer's issue is fully handled during initial intake. Resolution Summary is required for those statuses. The summary field appears when either status is selected and retains draft text when switching statuses. A direct Resolved case receives `resolvedAt` at its opened time; a direct Closed case receives `closedAt` at its opened time and leaves `resolvedAt` null, following the existing close transition rule. Direct Resolved or Closed creation clears Next Follow-up and does not send an assignment or Critical attention notice. The service generates `BXS-YYYY-NNNNNN` using the UTC year and server opened time. Neither is editable. Edit uses the same service validation and lifecycle tracking. Inactive historical categories remain selected and visible during edit, while new choices are active only.

**Purchased From** records where the end user says they bought the equipment. Optional `purchaseSourceText` retains the Support-entered answer after surrounding whitespace is trimmed; optional `purchasedFromAccountId` links a confidently identified existing CRM reseller, distributor, or retailer. Both can be set independently. The primary Account link, when present, identifies the customer or end-user organization; the purchased-from Account may be different. Support and Admin can edit either value; read-only case viewers can see them. The Account picker offers active, unarchived Accounts and does not require a new Account. An already linked Account remains available on edit if later archived or inactive; changing the link requires an active Account. Lifecycle history stores raw customer and purchase answers and Account names for link changes without displaying database IDs.

For future channel reporting, group linked cases by `purchasedFromAccountId`; review unlinked cases by the unresolved raw `purchaseSourceText`. Do not merge text variants automatically. A later cleanup can link answers such as CDW, CDW-G, and CDW Corporation to one Account while preserving each original answer. The nullable fields can also be supplied later by website or email intake through the case service; no ingestion or cleanup workflow exists yet. The Support list and filters remain unchanged. The purchased-from Account has a single-column index for future linked-account reporting; raw text has no B-tree index.

The detail page shows the case summary, description, resolution summary when relevant, attachments, then two collapsed history sections. **Case Timeline** is the operational narrative: one compact Case created entry, status/resolution/close/reopen events, assignment and priority changes, archive/restore, attachment activity, and linked Activities, Tasks, and Notes. Routine field edits and Next Follow-up date changes are omitted from this narrative. **Audit History** contains the field-level lifecycle record, including those omitted changes and internal timestamps. Its creation-time fields are grouped under **Case created · Initial values** for readability; the header count is the number of underlying entries represented. This is a display separation only: lifecycle events remain separate and append-only. Archived cases can be restored before editing. Archive and restore write history without changing status. Archive is not Close.

Case age is derived for display: open states use opened time to now; Resolved uses opened to resolved time; Closed uses opened to closed time. Days convert to approximate 30-day months from 60 days onward. No age is stored. Follow-up times use the viewer's configured time zone and show **Overdue** for unfinished cases with a past follow-up. Overdue notifications follow the rules below.

## Categories and lifecycle

Admins manage Support Case Categories at `/administration/support-case-categories`: add, rename, activate/deactivate, and reorder by sort number. Categories are retained when inactive, including their historical case references; the UI offers no delete. Statuses are New, Open, Waiting on Customer, Waiting on Internal, Resolved, and Closed. Priority is Low, Normal, High, or Critical. Source is Phone, Email, Web, Internal Referral, or Other. Existing service transitions, resolved/closed timestamp handling, reference validation, no-op suppression, and atomic history writes remain authoritative.

Support and Admin can create, update, archive, and restore all cases. Only active, unarchived Support or Admin users are eligible assignees. Sales and Sales Manager have read-only access under their existing Account visibility. Read Only and Marketing Manager retain their Step 1 read policy. Admin alone manages categories. Routes and actions check permissions server-side and pass the effective CRM actor to the Step 1 service. The operational UI itself required no migration; the later CRM integration adds nullable work links in its own migration.

## CRM integration

Account detail has a Support tab with bounded lists of open, High/Critical, and recently resolved cases, plus an open count. Contact detail shows up to 20 recent/open cases linked to that Contact. Both use existing Account/Contact read access and show Sales a read-only Support view. Archived cases are omitted from these current-context sections and remain available on the Support list when Archived or All is selected.

Activity, Task, and Note have optional `supportCaseId` relationships. They retain their Account, Opportunity, Project, Contact, assignee, and author semantics. The case detail offers Log Activity, Create Task, and Add Note to users with their existing work permission or the narrow Support case-work permission. Each opens the existing create form with the case Account and Contact context prefilled; the user reviews and saves. Ordinary Sales forms do not show a case picker in this version. A saved case relationship remains visible on edit. Note authorship uses the effective user; there is no Author selector.

Case links are validated on the server against case visibility, Account, and Contact. Support's case-work permission requires a linked case and does not grant Sales or Project write permission. New work is blocked on Archived and Closed cases; Resolved cases may receive work. Reopen or restore to add work to a Closed or Archived case. Existing linked records remain intact and historical. Existing linked work can still be edited under its normal CRM permission when the case later closes or archives. Adding work never changes case status.

Both history sections use newest-first order and buttons with expanded state for keyboard access. Case Timeline shows a maximum of 80 operational entries and retains the creation entry; Activity entries use the interaction date, type, subject, Contact, and responsible user. Task entries show creation and, when recorded on the current Task, completion; no separate Task history is inferred. Note entries show creation time, author, and a bounded preview. Archived Activities, Tasks, and Notes follow current CRM visibility and are hidden. Queries fetch up to 40 recent records from each work source, 81 recent lifecycle records to detect Audit History truncation, and at most 24 initial lifecycle records when needed to retain the creation narrative. Audit History shows at most 80 recent entries and indicates truncation only when expanded. Neither section queries unbounded history.

The migration adds nullable foreign keys and composite indexes for Activity `(supportCaseId, activityDate)`, Task `(supportCaseId, dueDate)`, and Note `(supportCaseId, createdAt)`. It does not rewrite existing records.

Read-only Gmail intake, email linking and selected attachment import are documented in [Support Email](support-email.md).

## Log an outbound email response

Gmail is the system of record for email. SalesHub is the system of record for the Support Case.

On an open or Resolved Case, Support and Admin users can choose **Log Email Response** alongside the existing Case work actions. This records an email already sent outside SalesHub. The compact form fills in the Case, its Account and Contact context, the current user, and the current time in that user's time zone. Recipient defaults to an active Case Contact's valid email, then to the most recently linked inbound sender when safe. Missing addresses stay blank and editable; the Support mailbox is never suggested as the recipient. The subject comes from the linked email or Case subject, preserving an existing `Re:` prefix. Recipient name/email, subject, and sent time can be corrected before saving.

Enter a short operational summary, such as “Sent firmware V1.36 and RFID setup guide; asked customer to retest.” Summary is required and limited to 2,000 characters. The five-line textarea grows with typing or pasting, supports vertical resizing, and scrolls at its height cap. This is an interaction log, not an email composer or a place to paste an email chain.

The log reuses `Activity` with the existing `EMAIL` type and `OUTBOUND` direction. It stores recipient name/email snapshots, subject, sent time, summary, server-derived Case/Account/Contact relationships, and the authenticated user as responsible user and creator. A Contact relationship is added only when that active Case Contact matches the logged recipient. Cases without Accounts are supported. No separate outbound email table, email body field, or attachment copy is created. Closed or archived Cases must be reopened or restored before adding a log. Read Only and other roles without both Case write and work write permissions cannot log a response.

The Case Timeline labels manually logged responses **Email Response Logged**, separately from inbound email. A logged response entry shows the Support user → recipient, sent timestamp, short summary, subject, and recipient address. Notes, Tasks, and Case updates retain their own quiet labels. This action works independently of the Gmail integration setting. It does not send email, fetch Sent Mail, change OAuth scopes, create drafts, change labels or read state, mirror Gmail, or copy email attachments. If a file belongs permanently in the Case, add it through the existing Case attachment workflow.

The additive `20261014170000_support_outbound_email_logging` migration adds two nullable recipient fields to Activity and permits a Case-only Activity parent. Apply it through the normal reviewed migration process before releasing this code; existing Activities and Activity types are preserved.

Deferred: RMA; warranty validation; SLA; portal; knowledge base; external Support sync; CSAT; canned responses.

## Operational dashboard, report, and notifications

Support's default Dashboard has My Open Cases, High / Critical Cases, Overdue Follow-ups, and Oldest Open Cases. Admins can add these widgets through Dashboard customization; Sales, Marketing, and Read Only do not receive Support management widgets by default. Widget counts use grouped or count queries and candidate lists are limited to five cases. Case links use BXS numbers.

The first-class report at `/reports/support-cases` follows the existing `supportCaseReadWhere` permission scope for every query and for Excel export. Filters include assignee, status, priority, Account and Contact name, category, Product/SKU part number, linked Purchased-From Account name, opened and resolved date ranges, follow-up state, search, archive state, and sort. Filters combine server-side; the detail table has 25 cases per page. Search also covers BXS number, subject, serial number, and the raw Purchased From answer. Linked purchased-from cases group by CRM Account; unlinked cases appear under **Unresolved Purchased From** and retain the raw text in detail and export. No text normalization occurs.

Management KPIs count current active cases (New, Open, Waiting on Customer, Waiting on Internal), current High/Critical cases, overdue follow-ups, and opened/resolved cases in the selected or current calendar month. Open aging buckets use elapsed time from `openedAt` to now: 0–2, 3–7, 8–14, 15–30, and 31+ days. Individual resolved/closed case age stops at its resolution/close timestamp. Follow-up states use the start of the New York business day; a case is overdue when its due timestamp is earlier than today and it is active and unarchived. Excel contains a summary sheet with generation context, filters, KPIs, and status/priority/category counts, plus a Support Cases sheet with typed dates and numbers. Empty exports include an explanatory row.

Notification Center has a Support category derived from the Support Case entity type. Assignment creates an INFO notice for the assigned user. A Critical assignment or priority transition creates a CRITICAL notice instead of a simultaneous assignment notice. Reopening a Resolved/Closed case sends an INFO notice to the current assignee. These event notices remain historical and dismissible. An overdue follow-up creates a WARNING notice only for its current eligible assignee, keyed to the case, assignee, and due timestamp. It resolves when the date moves to today/future, the case resolves or closes, is archived, or changes assignee. The existing notification evaluator scans Support Cases in bounded batches and returns evaluated, created, and resolved Support counts; deterministic source keys and `skipDuplicates` prevent repeat notices. Unassigned cases do not generate personal notices. Notifications do not send email or modify Gmail.

## Support Case attachments

Support and Admin users can add one file at a time from the case detail page. Attachments appear in a compact section above the Case Timeline; up to three are expanded by default, and larger sets start collapsed. Each row shows the original filename, type, size, upload time, and uploader. Uploads refresh the section without leaving the case page. A failed upload keeps the selected file and existing rows visible.

Attachment bytes live in the private DigitalOcean Space, under `<SPACES_PREFIX>/support-cases/<UUID>`. PostgreSQL stores only metadata and the Support Case relationship. The object key contains no filename, customer data, or database ID. The existing Spaces client signs download links for five minutes after checking case access. Files are served as downloads, except PDFs following the existing document policy. No permanent public object URL is exposed.

Accepted extensions are PNG, JPG/JPEG, WEBP, PDF, TXT, CSV, PRN, LOG, XML, JSON, ZPL, CFG, and CONFIG. Each file must be 25 MB or smaller. The server checks extension and browser MIME, verifies binary signatures, and requires UTF-8 text without embedded binary data for diagnostic text files. ZIP files are excluded under the current storage policy. Malware scanning is not included in Step 5; files should not be described as scanned.

Anyone who can read a Support Case can download its active attachments. Support/Admin users can add or remove attachments on active and Resolved cases. Closed and Archived cases are view only. Removal permanently deletes the binary from the configured object store, then retains the attachment metadata in PostgreSQL for audit, including its original filename, type, size, uploader, upload time, storage key, remover, and removal time. Removed attachments cannot be downloaded or restored through SalesHub; there is no recycle bin. The retained row supplies the semantic **Attachment removed** entry in the Case Timeline, with filename, timestamp, and actor. Storage keys are not shown in the UI.

If object deletion fails, removal stops and leaves the attachment active; the server logs the storage error. If object deletion succeeds but the metadata update fails, the server logs the case, attachment, key, and actor and returns an explicit error that the file was deleted but its record could not be updated. A subsequent Remove request retries idempotent object deletion and reconciles the metadata. Operators can also use the logged identifiers to reconcile the row. The download endpoint may temporarily offer a signed link in this rare state, but the deleted object cannot be fetched. Upload database failures use the same storage deletion helper to clean up their newly uploaded object. Automated retention is future policy work. Attachment reports, Excel export, search, and notifications are unchanged.

The isolated `saleshub_e2e` browser suite uses a local temporary object store enabled only by `E2E_AUTH_ENABLED=true` and `E2E_STORAGE_ENABLED=true` in a nonproduction server. Signed local URLs expire after five minutes. Production uses DigitalOcean Spaces.

## Complete Support Case Work v1

A Note must have at least one parent: Account, Opportunity, Project, or Support
Case. A Case alone supplies sufficient context, including when its Account is
NULL. Existing single-parent and multiple-parent combinations remain supported.
No-context Notes are rejected by the parser, service, and `Note_parent_check`.
Foreign keys and Account/Opportunity membership and Project/Opportunity link
validation still apply. On creation or relationship changes, a Note's Account
must match its Case's Account when a Case is selected. A retained Case-only Note
can keep its NULL Account after the Case gains an Account; no historical
relationships are backfilled or rewritten.

Migration `20261019180000_support_case_only_notes` replaces only the parent check
constraint. It changes no rows, columns, indexes, or foreign keys. The migration
harness covers fresh replay/schema parity, every-table preservation fingerprints,
Case-only inserts, orphan and missing-Case rejection, and later Account linking.

Support retains its existing Case read access. Task detail checks the persisted
Case's visibility even for direct URLs. Support can edit an unarchived Task
assigned to them, or an unassigned Task they created, if it belongs to an
accessible, unarchived Case that is not Closed. A Task with Opportunity, Project,
or Trade Show Lead context does not receive these expanded edit rights.
Permitted fields are Subject, Description, Due date, and Status, including
Complete and reopen to Open/In progress. Cancelled remains an existing Task
status. Assignment, priority, Contact, and parent relationships stay fixed on
this edit path. Existing Case Task creation and assignee eligibility are
unchanged. Broader reassignment policy remains an owner decision.

The normal Task detail/edit pages and WorkForm are reused. Case detail lists up
to 40 Tasks and exposes Edit / complete task only when eligible. Support has no
general Task list, bulk, archive/restore, or unrelated Sales Task edit rights.
Admin keeps its broader existing Task workflow.

On Support submit, a transaction locks and re-reads the persisted Task, effective
user, and Case; it checks active role, assignment, unchanged relationships, and
Case accessibility before using the shared Task save service. Impersonation
uses the effective user's authorization and attribution. A changed assignment,
removed Case link, closure, archive, or revoked user permission invalidates a
stale form.

Note added continues to be represented once by the existing Note timeline entry.
Changed Case Tasks write one append-only event per save to the existing Case
lifecycle ledger: Task completed, Task reopened, or Task updated. Events capture
the effective actor and before/after changed fields in the same transaction.
No-op saves create no events. Completion history survives reopening, and the
legacy completedAt timeline fallback is suppressed when its completion event
already exists. Existing Task assignment events and notifications are retained.

### Files changed for v1

- Note parsing/shared work saves and history: `app/lib/work.ts`.
- Case Task policy and transaction checks: `app/lib/support-work.ts`.
- Narrow route exception: `app/lib/authorization.ts`.
- Task actions and normal pages: `app/app/tasks/actions.ts`,
  `app/app/tasks/[id]/page.tsx`, `app/app/tasks/[id]/edit/page.tsx`,
  `app/app/tasks/new/page.tsx`.
- Note creation context: `app/app/notes/new/page.tsx`.
- Shared form and Case Task list: `app/components/work-form.tsx`,
  `app/app/support/cases/[id]/page.tsx`.
- Case history presentation: `app/lib/support-case-timeline.ts`,
  `app/lib/support-case-display.ts`, `app/components/support-case-history.tsx`.
- Help and contract documentation: `app/lib/help/topics.ts`,
  `app/docs/support-cases.md`.
- Constraint migration:
  `app/prisma/migrations/20261019180000_support_case_only_notes/migration.sql`.
- Validation: `app/scripts/test-migrations.py`,
  `app/tests/support-case-work.test.mjs`, `app/tests/support-integration.test.mjs`,
  `app/tests/task-workflow.test.mjs`, `app/e2e/support-case-work.spec.ts`.

### v1 validation (2026-10-19)

| Check | Result |
| --- | --- |
| Lint | Passed `npm run lint`. |
| Typecheck | Passed `npm run typecheck` and final `tsc --noEmit --incremental false`; production build also passed TypeScript. |
| Unit and Support/Task regressions | Node 22.23.3: 1,364 passed, one pre-existing optional SQL fixture test skipped. Includes authorization, direct pages/actions, impersonation, Note contract, and history coverage. |
| Migration | `python3 app/scripts/test-migrations.py`: all passed; fresh/populated replay, preservation, restrictive relationships, repeat deployment, and schema parity. Disposable database/network removed. |
| Playwright | 11 existing Support/Task regressions passed; final new Case-work suite passed all three viewports (1440×900, 768×1024, 390×844). Screenshots inspected and no horizontal overflow found. |
| Production build | Passed with Node 22.23.3 using `npm run build -- --webpack` and synthetic local database settings. Default Turbopack attempts hit the host worker-port binding restriction (`EPERM`); no compiler configuration was changed. |
| Diff | Passed `git diff --check`. |

The new browser suite covers Case-only Note creation, Task creation/edit/completion/
reopening, one completion entry after reopening, denied unrelated Task URLs,
and unchanged Case-only Notes after a later Account link. Temporary validation
logs, panic logs, and the production Webpack validation cache were cleaned.
No commit, push, deployment, Gmail connection, DigitalOcean change, or production
data mutation was performed. No policy decision blocks v1; expanding Support
reassignment or cross-linked Sales Task editing would require an owner policy.

## Support History Retrieval v1

The Case page keeps its existing collapsed recent timeline and audit sections: 40
rows per work source, 80 recent audit rows, a 24-row creation lookup when needed,
and at most 80 timeline entries. **Recent activity · Newest first** and
**View older history** explain the distinction without expanding the initial view.
The existing separate attachments and Case Tasks sections are unchanged.

`/support/cases/[id]/history` pages the same stored timeline sources in PostgreSQL,
25 entries at a time, newest first with a stable event-key tie-breaker. It includes
field changes previously available only in the recent audit section. All, Notes,
Tasks, Case changes, and Email activity filters use that same database query.
Creation fields are grouped with their original event using the existing display
helper; recorded Task completions suppress the legacy completion fallback across
the entire Case, including across page boundaries. No history rows are written.
A repeatable-read transaction keeps each request's count, page, and hydrated rows
consistent. New events between requests can shift numbered pages.

The query returns a count and at most 25 source keys before fetching their display
records in batches. The initial creation lookup remains capped at 24 rows. Note
previews use `left(body, 241)` in PostgreSQL, both in recent and older history;
full Note bodies are not fetched for list rows. **View full note** opens the
read-only `/support/cases/[id]/notes/[noteId]` view and preserves line breaks and
spacing. Back to history retains the filter/page; Back to Case is always available.
Note creation, editing, and archival rules are unchanged. Archived Notes remain
excluded, as in the existing timeline; closed or archived *Cases* remain readable.

Both new routes enforce `supportCaseReadWhere(actor, true)` with the effective
actor. Support and Admin retain unlinked Case access; other current Case viewers
retain their linked-Account requirement. There is no separate Support Manager
role in the current role model. Note reads also check the persisted Case/Note
relationship. Missing or moved historical Tasks and removed attachments have a
neutral unavailable state. Active attachments use the existing authorized download
endpoint; no storage keys are exposed. Stored email entries require no Gmail
connection or request. This retrieves Case evidence already in SalesHub, not a
complete mailbox or a newly synchronized email archive.

Existing Case indexes support these queries. Counts and deep offsets can still
scan/sort many event keys inside PostgreSQL; application memory stays bounded.
Review plans and consider cursor paging or an owner-approved index change if a
single Case exceeds 10,000 history entries or measured history latency exceeds
500 ms at p95. No migration is part of v1.

The isolated PostgreSQL query review used a Case with 1,000 Notes and requested
page 20 of the Notes filter. The service returned 25 previews with six SELECTs
in 28 ms; EXPLAIN ANALYZE returned 25 keys in 2.5 ms using existing Case indexes.
This is a local sample, not a production latency guarantee. The integration test
checks query bounds, preview projection, counts, and query count on every run.
