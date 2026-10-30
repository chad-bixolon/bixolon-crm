# Trade Show Partner Lead Handoff v1

## Pre-change audit (2026-10-30)

TradeShowLead has independent lifecycle status (New, Contacted, Qualified, Converted, Disqualified), routing (Unreviewed, BIXOLON Sales, Referred to Partner, Marketing Follow-Up), optional assigned Sales rep, routed Partner Account, referral time/actor/notes, follow-up metadata, and CRM links. Partners are active, unarchived Accounts with DISTRIBUTOR, VAR, ISV, OEM, or PARTNER Business Roles.

- Internal routing: import and individual/bulk routing call syncTradeShowFollowUp. Entering BIXOLON_SALES creates an open lead Task with the configured Trade Show business-day deadline (default two). Reassignment moves the current open Task, records an assignment event, and updates internal notifications. Leaving internal routing cancels its open Task and synchronizes notifications. Unchanged historical internal leads do not gain Tasks automatically.
- Partner routing: validates an eligible Account and writes routing, partner, first referral time/actor and editable referral notes. Optional assigned rep remains. No Task or notification is created. No sent/awaiting distinction or durable batch exists. Populating partner alone therefore leaves no operational handoff accountability.
- Reassignment: individual edits use updatedAt optimistic concurrency; bulk uses row locks, current-page/version checks and serializable transactions. Existing referral time/actor are preserved; changing partner overwrites the current partner reference without a full assignment history.
- Import: reviewed corrections retain raw source data. New imports use reviewed/default destinations; duplicate refresh updates source fields, preserving routing and CRM resolution. Internal imports create Tasks; partner imports do not.
- Views: event detail has paged lead filters and routing totals, CRM/contact resolution, import history, and linked internal Tasks. Follow-Up Queue is internal-sales oriented. Trade Show reports cover leads, routing and attributed Opportunities, without partner handoff/aging metrics.
- Resolution/conversion: reviewed Account/Contact creation or linkage updates CRM links/attribution. Opportunity conversion requires a resolved Account and reviewed participants (and active resolved Contact when linked), creates an Opportunity and sets Converted/convertedAt. It does not delete the lead. Marketing lacks sales.write; Sales can convert own assigned leads. Converted ownership/CRM links cannot be changed in the lead editor.
- Closure: Disqualified is the closed nonconversion status; there is no separate dismissal or lead archive. Closing a lead does not itself cancel its existing internal Task. Archiving the event hides operational queue work. Preserve that internal behavior.
- Policy: Trade Show read includes Read Only/Executive; Sales reads only assigned leads. Admin/Marketing Manager/Sales Manager assign; Sales may route its own lead. TRADE_SHOWS module visibility gates existing paths/actions. Maintenance History provides append-only actor/action/old/new metadata; Task assignment events and notifications provide internal work history.

Read-only categorical production audit: 130 Unreviewed/New, 7 BIXOLON Sales/New, 1 Partner/New; all unconverted on active events. No personal data was read. No production data was changed.

## Migration decision before implementation

Backfill only current REFERRED_TO_PARTNER leads with a partner, New/Contacted/Qualified, no converted Opportunity and an unarchived event to AWAITING_PARTNER_HANDOFF. Set awaiting age from migration time: historical referral is not evidence of delivery or reliable waiting age. Others retain null handoff state. Manufacture no batches, sent timestamps, Tasks or notifications. Apply only in disposable validation databases during this work.

## Business workflow

Select a partner and Follow-up Owner → Awaiting Handoff → Export & Complete Handoff → Sent to Partner → internal follow-up Task. Assigning a partner adds leads to the Partner Handoff queue; it does not complete the handoff or email the partner.

Open Trade Show → Partner Handoffs → partner. Review the leads, waiting time and Follow-up Owner. Add only notes suitable for external sharing in Partner Handoff Notes on each lead. Select Export & Complete Handoff and review the partner and lead count before confirming. The export includes all leads currently awaiting handoff to this partner, including those on other pages. Converted and disqualified leads are excluded. Send the downloaded workbook through your normal business channel. SalesHub will not email the partner automatically. Sent to Partner confirms that the leads were exported for the partner; it does not confirm that the partner received or acted on them.

Each completed handoff records the partner, Trade Show, completion date, person who completed it and leads sent, and creates one internal follow-up Task. The Follow-up Owner is shown by name. The Follow-up Owner selected during routing receives the Task. All awaiting leads for a partner must resolve to the same owner before handoff; use routing to align them if they differ. An explicit owner who can no longer receive Tasks must be replaced before completion. The Trade Show follow-up setting determines the deadline (normally two business days). Use Open follow-up Task from the handoff, or View Partner Handoff from the Task, to move between them. Complete the Task after following up through normal channels; completing it does not record partner feedback.

Moving an awaiting lead to internal Sales removes it from the partner queue and creates or reassigns its normal internal follow-up Task. Moving a lead to another partner starts a new Awaiting Handoff, even if it was previously sent. Earlier handoffs remain in history. Disqualifying an awaiting lead removes it from the queue; reopening it makes it await handoff again. Handoff history remains available after conversion.

Handoff History shows which leads were sent, when and by whom. Lead links show current SalesHub details. Re-export Handoff downloads the original lead details as they were when the handoff was completed, without changing lead status or creating another Task. Later edits are not included in that file.

## Design and controls

Separate nullable partner handoff status; assignment version, awaiting timestamp, sent timestamp and explicit externally shareable notes on lead. Relational batch and batch item membership, unique (lead, assignment version), immutable event/partner labels, one unique Task per batch. Each item retains only the external field whitelist as a small JSON row snapshot so historical export matches original disclosure after edits/conversion/renames. This is not an opaque lead-ID list or spreadsheet blob. No XLSX is stored in PostgreSQL or document storage.

Preview digest binds event version/owner, partner version and exact ordered lead versions/assignment versions. Server transaction rechecks effective actor/module, event/archive, partner eligibility, preview and actionable scope. Serializable snapshot with ordered lead row locks and conditional updates prevents concurrent reassignment/conversion/duplicate handoff. XLSX generation finishes inside the transaction before batch, sent transitions, Task/assignment notification and audit commit. Any failure rolls back everything. A committed download can still be interrupted by the browser/network; recover through explicit historical re-export. Successful routine batches use database audit only; unexpected route failures use Production Observability v1 safe identifiers.

Viewing follows existing Trade Show read/lead scope; export/mark sent and historical re-export use one centralized partner-handoff capability for Admin, Marketing Manager and Sales Manager. Read Only, Executive and Sales cannot perform these disclosure actions. Direct routes/services enforce TRADE_SHOWS visibility. No separate module.

Export whitelist: First Name, Last Name, Company (sourceCompany), Title, Email, Phone, City, State/Region (stateProvince), Country, Product Interest, Lead Qualification (status), Trade Show, Trade Show Date (startDate), Partner Handoff Notes, BIXOLON Internal Owner (assigned rep or event Marketing Owner), Partner, Source Notes, Competitor Mentioned (competitorSourceText), Current Product Being Used and Customer Pain Points. No raw import data, internal IDs, internal Referral Notes, Sales Notes, Activity/Opportunity notes, audit/authentication, pricing/internal strategy or unrelated CRM data. Text-only XLSX cells plus formula-prefix escaping protect spreadsheet consumers; filenames use sanitized ASCII business labels, timestamps and a random suffix (no internal identifiers). Downloads are private/no-store.

Partner Handoffs shows Awaiting Handoff, Sent to Partner and Overdue Handoffs totals. Overdue Handoffs counts leads awaiting handoff for seven or more days. By Partner shows Oldest Handoff, Overdue, Latest Handoff and Follow-up Owner. Sent counts represent current partner assignments; Handoff History retains completed handoffs after reassignment or conversion.

## Deferred

Partner portal/login, automatic email, partner API, spreadsheet return/import, outcome reporting, SLA scoring and partner rankings are possible later enhancements, outside v1.

## Files changed

- `app/app/trade-shows/[id]/leads/[leadId]/page.tsx`
- `app/app/trade-shows/[id]/page.tsx`
- `app/app/trade-shows/[id]/partner-handoffs/[batchId]/page.tsx`
- `app/app/trade-shows/[id]/partner-handoffs/export/route.ts`
- `app/app/trade-shows/[id]/partner-handoffs/page.tsx`
- `app/components/partner-handoff-export.tsx`
- `app/components/trade-show-lead-form.tsx`
- `app/docs/trade-show-follow-up-tasks.md`
- `app/docs/trade-show-import.md`
- `app/docs/trade-show-partner-handoff-v1.md`
- `app/e2e/trade-show-partner-handoff.spec.ts`
- `app/lib/authorization.ts`
- `app/lib/configuration.ts`
- `app/lib/help/topics.ts`
- `app/lib/observability.ts`
- `app/lib/trade-show-conversion.ts`
- `app/lib/trade-show-import.ts`
- `app/lib/trade-show-leads.ts`
- `app/lib/trade-show-partner-handoff.ts`
- `app/lib/trade-show-partner-state.ts`
- `app/lib/trade-show-routing.ts`
- `app/prisma/migrations/20261030120000_trade_show_partner_handoff/migration.sql`
- `app/prisma/schema.prisma`
- `app/prisma/tests/partner-handoff-backfill.sql`
- `app/scripts/test-migrations.py`
- `app/tests/trade-show-partner-handoff.test.mjs`

## Final validation

Validated on `feature/trade-show-partner-handoff-v1` with Node 22.23.4 and Prisma 6.19.3; neither dependency was changed.

- Lint: passed without warnings.
- Typecheck: passed.
- Complete unit/regression suite: 1,664 passed, zero failed, one existing optional read-only SQL-fixture test skipped (1,665 total).
- Final focused Trade Show, authorization, stale-edit, module-visibility and observability regressions: all 15 selected test files passed.
- Partner handoff real PostgreSQL/browser suite: all 15 scenarios passed, covering primary workflow, grouping, exact snapshots, field whitelist, generation/Task/conditional-transition rollback, duplicate and concurrent handoffs, reassignment, conversion races, historical re-export, revoked permissions, module disable, forged/stale previews, owner fallback and phone/tablet confirmation/cancel behavior.
- Existing Trade Show queue and module-visibility browser regressions: all 14 scenarios passed. The initial combined run exposed an existing conversion advisory-lock defect; both corrected conversion cases passed in the final partner suite. The fix supplies the integer overload and selects a supported scalar instead of PostgreSQL void.
- Production Webpack build: passed, including all three Partner Handoffs routes.
- Production Docker build: passed; local validation image `saleshub-partner-handoff-v1:validation`. No image was deployed or pushed.
- Complete migration replay: passed all 89 migrations, fresh/populated upgrades, preservation fingerprints, repeat deployment, Prisma schema parity, deterministic handoff backfill, state/append-only guards, compatibility and rollback tests. Disposable database container/network removed.
- `git diff --check`: passed. Next.js generated environment-file changes were restored.

The sandbox prevented some existing subprocess tests and Next.js's TypeScript configuration subprocess from running correctly. Approved runs outside the sandbox passed. Database validation used dedicated E2E/disposable databases only; the production audit was read-only. No production migration, data change, deployment, DigitalOcean change, commit, push, merge or branch switch occurred.

## Operational accountability and limits

Partner assignments now have a visible awaiting queue with counts/aging, an intentional audited handoff, preserved disclosure history, and one assigned internal follow-up Task per batch. Internal Sales continues to use its existing per-lead Task/notification workflow. This closes the operational gap in the implementation. It is not live until the additive migration and code are deployed through the normal release process.

An exported download can be interrupted after database commit. Open the completed handoff and select Re-export Handoff to download the original file again. SalesHub records the export and internal follow-up; sending the file and confirming receipt happen through the normal business channel.

## Pre-commit review

The review traced lifecycle changes, the external field whitelist, snapshot/member pairing, rollback, duplicate assignment guards, Task ownership/deadline, historical re-export, conversion, routing notifications, capabilities, module gates and migration/backfill. It found one disclosure-control race: the first advisory-lock SELECT established the serializable snapshot before waiting. If Trade Shows was disabled while the export waited, both initial export and historical re-export could subsequently read the old enabled setting and succeed after the disable committed.

Two deterministic PostgreSQL regressions reproduced this on the original code. The targeted fix retains the advisory lock and additionally locks the persisted TRADE_SHOWS setting row before authorizing either disclosure path. A setting updated since the waiting transaction's snapshot aborts it. Prisma's raw-query P2010/40001 serialization error becomes the normal RecordChangedError rather than an unexpected incident. No schema or backfill change was required.

Both regression tests now assert rejection, unchanged lead state, unchanged batch/Task counts and no new historical re-export audit entry. Historical re-export normally adds only its separate maintenance audit event; it never creates another handoff batch or membership, Task or state transition. Original partner snapshots and assignment-version membership remain immutable.

After this targeted fix, all 17 partner handoff PostgreSQL/browser scenarios passed in one run, including the primary workflow and both deterministic module-disable races. Focused Trade Show/authorization/stale-edit/module/observability regressions (15 test files), lint, typecheck, production Webpack, production Docker and diff/whitespace checks passed. Unchanged schema/backfill retain the preceding complete 89-migration replay validation; no production migration was run. The reviewed candidate is appropriate to commit, with no remaining blocking findings. This review changed only the handoff module guard, its two regression tests and this documentation; generated Next.js file changes were restored.

## Business wording polish (2026-10-30)

Updated routing confirmation, Partner Handoffs summaries, partner lead review, export confirmation, history, handoff details, follow-up Task wording and help content. Labels now use Export & Complete Handoff, Overdue Handoffs, Follow-up Owner, Completed by, Leads sent, Open follow-up Task and Re-export Handoff. Follow-up Owner displays the resolved name using existing eligibility rules. Tasks link to the completed handoff through View Partner Handoff; older generated queue URLs are hidden in the Task detail description without changing stored data. The Task title format is retained, with singular wording for one lead.

This pass changes wording and presentation only. Routing, permissions, schema, migrations, transactions, export contents, Task creation and due-date rules are unchanged. Sent to Partner continues to mean exported for the partner, without claiming receipt or action.

Validation for this pass: lint, typecheck, all 12 focused Trade Show/Help/Task regression files, all 17 partner handoff PostgreSQL/browser scenarios and git diff --check passed. The primary browser scenario covers bulk partner assignment, awaiting review, export/completion, the follow-up Task link, history and re-export; phone/tablet confirmation checks also passed. An initial unit run overlapped Prisma client generation and encountered a transient package-read error; the rerun passed after generation completed. Broader production builds and migration replay were not repeated because this wording and presentation pass does not change the underlying workflow or schema. Validation used the dedicated local E2E database. No production data, DigitalOcean resources, deployment or Git history was changed. Ready for commit/release review.

## Routing accountability audit and implementation (2026-10-30)

Before this pass, both the detail KPI (`tradeShowEventSummary`) and list summary (`tradeShowKpis`) counted any lead with a non-null `assignedSalesRepUserId` as Assigned. This was a Sales-rep presence count, independent of routing: it omitted Partner/Marketing leads without a rep and could include an Unreviewed lead with a rep. The list query did not select routing. The existing detail breakdown already separated BIXOLON Sales, Partner, Marketing and Unreviewed. Routing is stored independently from lead qualification and Partner Handoff status. Sales routing creates its existing per-lead Task; Marketing routing does not create a partner handoff; partner routing starts Awaiting Handoff and completion marks Sent to Partner.

Both list and detail now use `routedTradeShowCount`: BIXOLON Sales + Partner + Marketing, excluding Unreviewed. Awaiting and sent partner leads both remain Routed. The existing breakdown stays visible without extra handoff totals on the main event page.

New partner routing captures one explicit Follow-up Owner, including bulk routing, individual edits and imports. Bulk routing applies the same owner to every selected lead. Normal general-Task eligibility is reused (active, unarchived Admin, Sales, Sales Manager and Marketing Manager), with server-side eligibility and routing-permission checks. A nullable `TradeShowLead.partnerFollowUpOwnerId` relation and index are added by `20261030180000_trade_show_partner_follow_up_owner`; Assigned Sales Rep cannot represent this responsibility because it has a distinct Sales-only policy and CRM/export purpose. No owners are backfilled and no completed history is changed. Legacy null assignments retain eligible event Marketing Owner, then eligible handoff user fallback. Explicit unavailable owners fail confirmation rather than falling back.

Bulk partner routing uses a short-lived signed review of the event, selected lead versions, partner, owner, optional Sales rep and notes. Commit holds destination-user/partner eligibility locks, revalidates actor and selection versions/current page, verifies the reviewed intent and updates all selected leads in the existing serializable transaction. Owner changes on awaiting leads update current responsibility without restarting awaiting age or rewriting history; reassignment to another partner starts a new lifecycle with an owner. Leaving partner routing clears current partner responsibility and preserves the existing internal Sales Task/notification workflow. Same-partner sent ownership is retained; it cannot be changed through routing.

Handoff preview binds each explicit owner and the resolved Task owner into its existing digest. Completion locks/revalidates that owner and creates exactly one Task using the existing due-date and notification rules. A mixed-owner partner queue must be aligned before export. The handoff transaction, duplicate protection, audit and rollback behavior are retained. The export field coverage correction below expands only approved lead context; historical re-export preserves the original disclosure. Completed history displays the Task's existing `originalAssignee` relation, preserving the owner at completion independently of later lead routing or Task reassignment; no duplicate historical owner field is introduced.

## Partner export context audit (2026-10-30)

The previous 16-column export included Product Interest, Qualification and Partner Handoff Notes, but omitted Source Notes and other original customer context. New exports retain those columns and append Source Notes, Competitor Mentioned, Current Product Being Used and Customer Pain Points (20 columns total). All values come from existing fields; no duplicate notes fields are introduced.

| Classification | Existing fields/context | Export treatment |
| --- | --- | --- |
| Partner-shareable lead context | `sourceNotes` | Included as Source Notes, including original import Notes and custom comments explicitly mapped into Source Notes. Multiline text is preserved. |
| Partner-shareable lead context | `productInterest`, `status` | Included as Product Interest and Lead Qualification. |
| Partner-shareable referral context | `partnerHandoffNotes` | Included as Partner Handoff Notes; this is the existing field intended for partner-facing referral notes. |
| Partner-shareable customer context | `competitorSourceText`, `currentProductBeingUsed`, `customerPainPoints` | Included as Competitor Mentioned, Current Product Being Used and Customer Pain Points. Review these shared fields before export. |
| Internal-only routing and Sales context | `referralNotes`, `salesNotes`, `followUpAt`, `lastContactedAt`, internal referral actor/time | Excluded. Referral Notes is already explicitly labeled internal; it is not silently reclassified as partner-facing. |
| Internal-only CRM context | linked Activity/Opportunity/general CRM notes, audit/history comments, pricing and internal strategy | Excluded; the export reads no linked note, pricing or history collections. |
| Internal-only event/import administration | Trade Show `description`, source filename/sheet/row, raw import JSON, reviewed-override JSON, source IDs, resolved competitor ID | Excluded. The event description contains general event/Marketing notes, not a per-lead referral message. Unmapped spreadsheet comments must be deliberately mapped/reviewed into Source Notes to travel with the referral. |

Text-only cells and existing formula-prefix escaping apply equally to all shared note fields. Blank context is emitted as empty cells without changing row width. The source fields are reviewed lead values; raw import data remains private.

`20261030190000_trade_show_partner_export_context` expands the snapshot width constraint to accept the original 16 and current 20 columns, without modifying stored rows or weakening append-only history. Re-export chooses the original headers from the stored row width. Older handoffs retain the original 16 columns and do not gain Source Notes or other context that was not part of their original disclosure. New handoffs preserve the 20-column snapshot even if source notes or current routing later change.

## Routing accountability and export coverage — final validation

Validated with Node 22.23.4 and Prisma 6.19.3; package versions are unchanged.

- Full lint and final changed-file lint checks passed without warnings.
- Typecheck passed.
- All 17 selected regression files passed, covering Trade Shows, partner exports, import/routing, authorization, stale edits, mutation safety, Task workflow, Help and dashboard behavior.
- All 33 Trade Show PostgreSQL/browser scenarios passed together, including explicit-owner selection through Task creation, persisted detail/edit values, inactive-owner races, signed stale routing intent, mixed-owner rejection, original ownership history, Source Notes/context export, legacy 16-column re-export, internal Sales regressions and phone/tablet confirmations.
- All 91 migrations passed full disposable PostgreSQL replay: fresh and populated upgrades, schema parity, repeat deployment, preserved fingerprints, compatibility and rollback checks. Both new migrations preserve existing data. Tests accept original 16-column and expanded 20-column snapshots, reject unsupported widths and retain immutable history. Disposable resources were removed.
- Production Webpack build passed. Its first check exposed a client import of server signing dependencies through a dashboard permission helper; the unchanged queue-visibility predicate now lives in a small shared policy file. Dashboard regression checks passed.
- Production Docker build passed; local image `saleshub-trade-show-routing:validation` was built but not pushed, run or deployed. The existing release-status dynamic-filesystem tracing warning remains nonblocking.
- `git diff --check` and whitespace checks for new files passed. Generated Next.js environment changes and Python bytecode were removed from the source diff.

The export regression tests verify Source Notes and partner-facing referral notes, the approved customer-context fields, internal-note/privacy exclusions, formula-prefix protection for shared note fields, multiline text and blank cells. Excel readers normalize CRLF line endings to LF while preserving the line break; the stored snapshot retains the original text.

Trade Show list/detail now give a consistent Routed versus Unreviewed picture within existing visibility rules. Selecting a Follow-up Owner changes Task responsibility without broadening lead permissions. Legacy fallback is used only when no explicit owner was captured; completed history and original disclosure contents remain intact. This candidate is ready for commit/release review. No branch switch, commit, push, merge, deployment, DigitalOcean change or production data change was performed.
