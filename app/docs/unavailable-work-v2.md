# Unavailable Work / Reassignment Cleanup v2

When a user is inactive, archived, or loses the role required for current work, SalesHub retains historical attribution and surfaces current responsibility in Administration → Ownership & Reassignment. Deactivation never automatically reassigns a record. The same active-work predicates drive cleanup counts, paged rows, and user-change impact where a user-specific owner exists. Unassigned active Demo and PE follow-up work is visible in cleanup but has no user-specific impact count.

| Entity | Current responsibility needing review | History kept |
| --- | --- | --- |
| Account / Contact | Active Account owner; Contact inherits it | Inactive/archived Account and Contact history |
| Opportunity | Open, operational owner | Closed Opportunity owner and owner history |
| Project | Planning, Active, On Hold operational owner | Completed, cancelled, archived owner |
| Task | Open/In Progress assignee; Support-linked policy uses Support Task eligibility | Completed Task assignee and completed Activity attribution |
| Support Case | Unresolved assignee | Resolved/closed assignment; reopening validates the current assignee |
| Trade Show Lead | NEW, CONTACTED, QUALIFIED leads routed to BIXOLON Sales with an assigned rep on a nonarchived event | Converted/disqualified lead, other routing, imports, referrals, campaign influence |
| Trade Show | Nonarchived event with no past end date and an unavailable Marketing owner | Past event owner; creator/editor metadata |
| Demo | PENDING/APPROVED or deployed unreturned units with missing/ineligible `operationalOwnerId` | Requester, reviewer, shipper, return actors and fully returned requests |
| Price Exception | Active follow-up in progress, or an active PE entering its 90-day follow-up window, with missing/ineligible explicit follow-up owner | Assigned/source salesperson and closed follow-up history |
| Audience / saved Report | Unarchived management owner | Separate creator/editor fields, definition, personal/shared visibility |
| Sales Plan / Target | New assignments use Sales Plan eligibility; official owner/rep attribution is not transferred through cleanup | Official prior/current plan and target attribution, snapshots, import evidence |
| Campaign | No operational owner field; references are creator/editor metadata | All campaign attribution |

Admin can transfer current ownership in the listed recovery groups. Trade Show lead routing, Trade Show Marketing ownership, and Support Case work remain available to their functional managers through the existing module workflows. Global recovery, Audience/Report transfers, and disabled-module cleanup require a true active Admin. A Report recipient must be able to run and create its report type. Private definitions remain private after transfer. PE salesperson and Demo historical actors never change. The new Demo owner relation restricts User deletion and has no backfill.

An explicit PE follow-up owner can open that PE even when its historical salesperson is someone else. This record scope is granted by the follow-up assignment; it does not change the salesperson field or broaden role capabilities.

Cleanup counts use database `count`, rows use 25-record server pages, and eligible-user choices are queried once for the selected group. Recovery rechecks persisted actor authority, destination eligibility, issue membership, and `updatedAt` version inside a serializable transaction. Successful changes write append-only Maintenance History. Existing Task/Case and Trade Show bulk operations retain their 20-row selection and rollback behavior. Admin sees actionable counts for disabled optional modules with a label; ordinary module routes remain blocked.
