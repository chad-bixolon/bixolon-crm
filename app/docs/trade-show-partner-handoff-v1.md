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

Open Trade Show → Partner Handoffs → partner. Review awaiting count, aging and internal owner. Add only notes suitable for external sharing in Partner Handoff Notes on each lead. Review the partner and count, then confirm Export & Mark Sent. Only actionable, unconverted Awaiting Handoff leads are included. Send the downloaded workbook through your normal business communication channel; SalesHub sends no external email. Sent means an authorized user intentionally generated the external handoff, not proof of email delivery or partner receipt.

Each successful batch records partner/event labels, actor, timestamp, count, filename, relational lead membership and one linked internal Task. The eligible Marketing Owner receives the Task; otherwise the eligible performing user does. The existing Trade Show follow-up business-day setting applies (default two business days). Complete the Task after following up through normal channels; Task completion does not invent partner feedback.

Moving an awaiting lead to internal Sales clears current partner handoff state and creates/reassigns its normal internal Task. Moving to another partner or returning to partner routing creates a new awaiting assignment/version. Sent leads moved to another partner need a fresh handoff. Leaving partner routing clears current partner state, while previous batch memberships, sent time and partner snapshots stay in history. Closing an awaiting lead removes it from handoff work; reopening starts awaiting again. Converted/sent history remains accessible; conversion is permitted under existing rules.

History shows metadata and included lead links, not exported cells. Explicit Historical Re-export reproduces the original approved snapshot with a historical filename, records an audit event, creates no Task and changes no lead status. It may include information that was valid at the original handoff; it does not silently refresh customer data.

## Design and controls

Separate nullable partner handoff status; assignment version, awaiting timestamp, sent timestamp and explicit externally shareable notes on lead. Relational batch and batch item membership, unique (lead, assignment version), immutable event/partner labels, one unique Task per batch. Each item retains only the external field whitelist as a small JSON row snapshot so historical export matches original disclosure after edits/conversion/renames. This is not an opaque lead-ID list or spreadsheet blob. No XLSX is stored in PostgreSQL or document storage.

Preview digest binds event version/owner, partner version and exact ordered lead versions/assignment versions. Server transaction rechecks effective actor/module, event/archive, partner eligibility, preview and actionable scope. Serializable snapshot with ordered lead row locks and conditional updates prevents concurrent reassignment/conversion/duplicate handoff. XLSX generation finishes inside the transaction before batch, sent transitions, Task/assignment notification and audit commit. Any failure rolls back everything. A committed download can still be interrupted by the browser/network; recover through explicit historical re-export. Successful routine batches use database audit only; unexpected route failures use Production Observability v1 safe identifiers.

Viewing follows existing Trade Show read/lead scope; export/mark sent and historical re-export use one centralized partner-handoff capability for Admin, Marketing Manager and Sales Manager. Read Only, Executive and Sales cannot perform these disclosure actions. Direct routes/services enforce TRADE_SHOWS visibility. No separate module.

Export whitelist: First Name, Last Name, Company (sourceCompany), Title, Email, Phone, City, State/Region (stateProvince), Country, Product Interest, Lead Qualification (status), Trade Show, Trade Show Date (startDate), Partner Handoff Notes, BIXOLON Internal Owner (assigned rep or event Marketing Owner), Partner. No raw import data, internal IDs, source/referral/Sales notes, audit/authentication, pricing or unrelated CRM data. Text-only XLSX cells plus formula-prefix escaping protect spreadsheet consumers; filenames use sanitized ASCII business labels, timestamps and a random suffix (no internal identifiers). Downloads are private/no-store.

Operational reporting lives in Partner Handoffs: awaiting/sent totals and partner grouping, oldest waiting days, waiting 7+ days, latest handoff, and internal owner. Sent counts represent current partner assignments; historical batch counts retain prior disclosures after reassignment/conversion.

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

An exported download can be interrupted after database commit. Recover from the original batch’s explicit Historical Re-export; do not reset or silently resend its assignment. SalesHub records the intentional export and internal follow-up, while the actual external sending/receipt remains in the normal business channel.

## Pre-commit review

The review traced lifecycle changes, the external field whitelist, snapshot/member pairing, rollback, duplicate assignment guards, Task ownership/deadline, historical re-export, conversion, routing notifications, capabilities, module gates and migration/backfill. It found one disclosure-control race: the first advisory-lock SELECT established the serializable snapshot before waiting. If Trade Shows was disabled while the export waited, both initial export and historical re-export could subsequently read the old enabled setting and succeed after the disable committed.

Two deterministic PostgreSQL regressions reproduced this on the original code. The targeted fix retains the advisory lock and additionally locks the persisted TRADE_SHOWS setting row before authorizing either disclosure path. A setting updated since the waiting transaction's snapshot aborts it. Prisma's raw-query P2010/40001 serialization error becomes the normal RecordChangedError rather than an unexpected incident. No schema or backfill change was required.

Both regression tests now assert rejection, unchanged lead state, unchanged batch/Task counts and no new historical re-export audit entry. Historical re-export normally adds only its separate maintenance audit event; it never creates another handoff batch or membership, Task or state transition. Original partner snapshots and assignment-version membership remain immutable.

After this targeted fix, all 17 partner handoff PostgreSQL/browser scenarios passed in one run, including the primary workflow and both deterministic module-disable races. Focused Trade Show/authorization/stale-edit/module/observability regressions (15 test files), lint, typecheck, production Webpack, production Docker and diff/whitespace checks passed. Unchanged schema/backfill retain the preceding complete 89-migration replay validation; no production migration was run. The reviewed candidate is appropriate to commit, with no remaining blocking findings. This review changed only the handoff module guard, its two regression tests and this documentation; generated Next.js file changes were restored.
