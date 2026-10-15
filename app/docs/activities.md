# Activity quality v1

Activities record completed customer interactions. Tasks track work still to do, with an assignee, status and optional due date. Calendar events describe scheduled meetings and retain the original meeting interval; importing a Calendar event does not create an Activity automatically.

## Types and fields

Types are configurable `ActivityType` lookup records, not a closed enum. The standard types are:

| Code | Intended use |
| --- | --- |
| CALL | A completed telephone or voice call. Put the short summary in Subject; an outcome is optional. |
| MEETING | A completed meeting. Activity date is its start time. Use Calendar Matches when logging a synced meeting. |
| EMAIL | A sent or received email. Activity date is the sent/received time, not a meeting interval. |
| FOLLOW_UP | A completed follow-up interaction. Planned follow-ups belong in Tasks. |
| DEMO | A completed product demonstration. |
| SITE_VISIT | A completed customer/site visit. |
| QUOTE_PROPOSAL | A completed quote/proposal interaction. |
| SAMPLE_EVALUATION | A completed sample/evaluation interaction. |
| TECHNICAL_REVIEW | A completed technical discussion or review. |
| TRADE_SHOW | A completed trade show interaction. |
| OTHER | A completed interaction that does not fit another active type. Use a specific Subject. |

No type codes are renamed, merged or removed. Custom active types remain supported. An existing Activity may retain its inactive type; new Activities and changed types must use an active lookup record. The new form defaults to Call if active, to the sole available type if there is only one, and otherwise asks the user to choose.

All types require a short Subject (1–200 characters), valid type and occurrence date. New Activities require an eligible responsible user; an assigned Activity cannot be cleared to an unassigned state. Historical unassigned records may remain unassigned on unrelated edits. New or changed occurrence dates must be in the past or present. Older future-dated records retain their date on unrelated edits, including timestamp precision beyond the minute displayed by the form.

An Account is required except for work belonging to a real Support Case without an Account. Description (up to 5,000 characters), Outcome and Next step (up to 2,000 each), Contacts and Follow-Up Date are optional for every type. A concise Subject provides the required summary for a Call; an additional Outcome is useful but not compulsory. Meeting duration/end time are not added to the Activity schema: a manually logged meeting needs an occurrence time, while synced Calendar events already retain the meeting interval. Email does not require duration, attendees, outcome or next step. Direction is optional and defaults to N/A; use Inbound/Outbound for calls and emails where relevant. Existing direction values are retained.

The ordinary form explicitly labels its date/time as UTC and defaults to the current time. Calendar logging uses the connected user's timezone and converts to UTC on the server. Activity detail and entity timelines display Eastern time with an ET label. Description, Outcome and Next step grow with content, permit manual vertical resizing and scroll at a bounded height.

A Follow-Up Date is reference metadata, not a reminder or task state. On creation, users may explicitly choose **Create follow-up task** after entering a date. The existing transaction creates an assigned Task along with the Activity; editing an Activity does not silently create another Task. An Activity remains completed work regardless of whether its type is Follow-up or it has a future follow-up date.

## Relationships and prefills

- An Activity has at most one Account, Opportunity, Project and Support Case, and may link multiple Contacts through `ActivityContact`.
- A selected Opportunity must have the selected Account as a participant.
- A selected Project must have the selected Account as its primary Account or a participant. When both Opportunity and Project are selected, the Opportunity must be linked to that Project.
- Newly linked Contacts must be active and unarchived and either belong to the selected Account or be unassigned. Unassigned Contacts are an intentional existing workflow.
- A Support Case Activity must use exactly the Case's Account, including a null Account. The Case must be accessible; new work requires an open, unarchived Case. Contacts must be compatible with that Account; additional Contacts at that Account are allowed, so they need not be the Case's primary Contact.
- Unchanged historical relationships can survive parent archival, unlinking or Contact reassignment. Existing Contact history cannot bypass validation when Account or Case context changes. The existing prohibition on changing an Account with linked Contact history remains.
- Project edit permissions, user eligibility and existing Sales/Support role checks remain in force. Read Only users may view details but cannot create, edit, archive or use write shortcuts. Support can open a Case Activity detail only after the server verifies access to its Case; this grants no general Sales Activity or edit access.

Contextual Quick Actions remain permission-aware. Account actions prefill Account; Contact actions prefill Contact and its known active Account; Opportunity actions prefill Opportunity and a single known Account; Project actions prefill Project and its known primary Account (or its sole participant when no primary exists). Multiple Accounts without an explicit primary remain unselected. Support Case actions derive Case, Account and Contact from authorized server context. Nothing infers an Opportunity, Project or Contact from a larger set of candidates.

Activity creation also derives that safe Account context when reached with only a Contact, Opportunity or Project ID. Explicit Account selections are validated, inferred Accounts must be active and unarchived, and incompatible submitted relationship combinations are rejected before writing. Task and Note prefill behavior is unchanged.

## Calendar identity and overlap

Calendar logging uses the existing `GoogleCalendarEventReview.activityId` link and transaction-scoped event lock. Repeated and concurrent logging attempts create only one Activity for that Calendar event. Cancelled, ignored and unfinished events cannot be logged. My Day shows the Calendar event with its logged status and suppresses the linked Activity's duplicate timeline entry; the Activity still counts as one completed Activity. Activity detail and related entity timelines identify Calendar-linked meetings.

A manually logged Meeting has no Calendar identity. Matching a title, timestamp or Account is insufficient to safely identify the same interaction. Automatic matching of manual records, cross-user Calendar copies and historical reconciliation are deferred; no historical records are merged or deleted. Log synced meetings through Calendar Matches and avoid also logging them manually. Adding a general source identity/deduplication framework would require broader design work.

## Support email

Gmail remains the source of truth for email. Inbound messages are linked email context (`SupportCaseEmail`), shown on the Case timeline, rather than duplicate Activity records. Outbound **Log Email Response** records an existing lightweight `EMAIL`/`OUTBOUND` Activity with sent time, responsible user, short summary and recipient metadata. It does not send mail, fetch a full email body or create a Calendar event. Case relationships and author come from authorized server context. An edited recipient is not automatically attributed to the Case's Contact unless its email still matches. A Case without an Account can still log outbound email.

Existing outbound presentation remains distinct from inbound linked emails and keeps its lightweight summary; the general Activity form does not replace that workflow. Manually logging an email that is already linked or logged is not automatically deduplicated because it has no Gmail message identity. No inbound ingestion behavior changes in v1.

## Display and reporting

Account, Opportunity and Project Activity timelines use the same relationship context renderer as Activity detail: Account, Opportunity, Project, Support Case when applicable, and Calendar source when linked. Timelines retain type, date/time, responsible user, Subject, Contacts, description and optional outcome/next step/follow-up date. Links open readable details instead of requiring edit access. Case timelines keep their existing business-event and inbound/outbound email presentation, with general Activity links opening authorized details.

Reporting continues to use stable type codes, explicit responsible user (`userId`), occurrence date (`activityDate`), Subject and validated relationships. Audit author fields (`createdById`/`updatedById`) remain separate from the responsible user. No scoring, ranking or passive time tracking is introduced. Existing reports and historical counts are not rewritten, including older future-dated Activities.

## Compatibility and scope

This change has no Prisma schema changes, migrations, type normalization, bulk data updates, deletions, commits or deployment. Optional historical data renders without requiring new metadata. Duration, general manual deduplication, configurable per-type required fields and replacing the Activity model with a planning system are outside v1.

## Validation

Unit coverage includes every built-in type and a custom type, future occurrence rules, legacy dates/owners/types, user requirements, safe Account inference, invalid Account/Contact/Opportunity/Project/Case combinations, retained Contact context changes, shared relationship rendering and Read Only denial. Existing Calendar concurrency/My Day, reporting and outbound Support Email regression suites remain applicable.

`e2e/activity-quality.spec.ts` exercises Call, Meeting, Email and Follow-up creation, error recovery, textarea growth/resizing style, timeline/detail links and Read Only access at desktop (1440px), tablet (768px) and phone (390px), plus entity prefills, ambiguous Accounts and Support Case authorization. Existing Quick Actions and outbound Support Email browser tests provide additional integration coverage.

### Verification on 2026-10-15

- `npm run lint` and `npm run typecheck`: passed.
- Relevant Node tests: 13 suites passed (`activity-quality`, `work`, `calendar-activity-guard`, `my-day`, `support-outbound-email`, `support-integration`, `activity-contact-picker-ui`, `account-activity-reporting`, `auth`, `assignment-eligibility`, `task-workflow`, `failed-save-form-state`, `contact-relationship-lifecycle`).
- Playwright: Activity quality, Quick Actions, entity pickers, Support outbound email and Support detail scenarios passed across the selected runs. Activity logging/detail and outbound email were checked at 1440px, 768px and 390px. Captured Activity layouts were visually reviewed. The final Activity/Support detail run passed all six tests after correcting fixture setup and removing the obsolete edit-only Case timeline link guard.
- Production build: `npm run build -- --webpack` passed, including compilation, TypeScript, static generation and tracing. Default `npm run build` was attempted but Turbopack's CSS worker could not bind a local port in this execution environment, including on retry with escalation. No bundler configuration or package scripts were changed.
- `git diff --check`: passed. No schema changes, production data updates, commits or deployment.

Inspection detail: before v1, Project Quick Actions supplied the primary Account only. The sole-participant fallback is new in v1. Account/Opportunity/Project and new Contact checks were already transactional; v1 narrows the retained Contact-history exemption so changing Account or Case context cannot reuse an incompatible Contact link.
