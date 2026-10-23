# Authorization Correctness & Policy Foundation v1

SalesHub uses eight predefined functional roles: Administrator, Sales Manager, Sales, Support Manager, Support, Marketing Manager, Executive, and Read Only. A fixed delegated User Administration flag is available only to Sales Managers; it is not a custom role or arbitrary permission override. The lifecycle extension below documents its boundary and audit history.

## Three separate decisions

1. **Capability:** `lib/authorization.ts` owns `predefinedCapabilities`. `can` rejects missing, inactive, and archived actors, then checks the role's explicit capability set. `requirePermission` protects page reads; `requireMutation` protects server actions; `assertPermission` protects services accepting an actor. Existing module permission names remain compatible. No write permission implicitly grants another capability.
2. **Record policy:** after the capability check, persisted ownership, assignment, relationships, and operational state determine whether the actor may change a specific record. Read scopes and edit scopes are independent. `taskEditWhere` and `assertTaskEdit` centralize general Task edit responsibility. Project and Opportunity policies retain their existing ownership rules.
3. **Eligibility:** `lib/assignment-eligibility.ts` defines named business populations, without consulting `can`. `eligibleUserWhere` supplies queries; `eligibleUser` validates selected users. Current eligibility applies to new assignments, not historical attribution.

The request proxy is defense in depth. A protected page does not authorize its exported actions. Do not claim every persistence helper checks authorization: legacy storage primitives such as `saveTaskInTransaction` expect an already-authorized caller. User administration is deliberately stricter: both `submitUser` and `saveUser` enforce authorization independently. Actions must obtain the effective actor from the authenticated server context, never from form fields. Test-as-user uses the effective role; privileged real identities cannot lend capabilities to the effective user.

## Predefined capability matrix

The complete, executable matrix is `predefinedCapabilities`; this table summarizes business access. “Sales roles” means Sales and Sales Manager.

| Area / capability | Current access |
| --- | --- |
| Accounts / Contacts read | All eight roles |
| Accounts / Contacts write | Admin and Sales roles |
| Opportunities read | Admin, Sales roles, Marketing Manager, Executive, Read Only |
| Pipeline / `sales.read` | Admin, Sales roles, Executive, Read Only |
| Sales / Opportunity write | Admin and Sales roles; record policy still applies |
| Projects read | Admin, Sales roles, Marketing Manager, Executive, Read Only |
| Projects write | Admin and Sales roles; record policy still applies |
| Tasks / Activities / Notes read | Admin, Sales roles, Marketing Manager, Executive, Read Only; Support and Support Manager have case-context access |
| General Task / Activity / Note write | Admin, Sales roles, Marketing Manager |
| `support-work.write` | Admin, Sales roles, Marketing Manager, Support, Support Manager; case and record checks still apply |
| Reports | Report-type read checks remain in `reporting.ts` |
| `reports.engagement.read`, `reports.operational.read` | Admin, Sales roles, Executive; read access is independent of report-definition management |
| `reports.create` | Admin, Sales roles, Marketing Manager; report-type access still required |
| `reports.share` | Admin, Sales Manager, Marketing Manager |
| `forecast.read` | Admin, Sales roles, Executive, Read Only |
| `snapshots.read` | Admin, Sales Manager, Executive |
| `pipeline-movement.read` | Admin, Sales roles, Executive |
| Support Cases read | All roles, with case-context query policy |
| Support Cases write / categories | Admin, Support, Support Manager / Admin and Support Manager for categories |
| `support-inbox.write` | Admin, Support, Support Manager; Gmail feature flag and real-identity connection checks remain |
| Marketing read/write | Admin, Marketing Manager, Executive read / Admin and Marketing Manager write |
| Trade Shows | Existing read/manage/lead/assign/resolve/route grants retained |
| `pricing.read` | Admin, Sales roles, Marketing Manager, Read Only; Executive excluded |
| Products read / write | All roles / Admin only |
| Sales Plans read | Admin, Sales roles, Executive, Read Only |
| Sales Plans allocate / manage | Admin and Sales roles / Admin and Sales Manager |
| `users.manage` | Admin and explicitly delegated Sales Managers |
| `integrations.manage`, `configuration.manage` | Admin only |
| `data-quality.manage`, `system-health.read`, `maintenance.manage` | Admin only |

Ordinary catalog tiers remain available with `products.read`. Customer/ODM price rows (including previous prices, tariff fields, final unit prices, effective dates, and negotiated notes) require `pricing.read`. The Product data loader excludes the customer-price relation from its query for unauthorized actors and returns no customer price rows; the server component also gates the negotiated pricing section. Product maintenance continues to require `products.write`.

## Owner and assignee populations

Every population requires `active: true` and `archivedAt: null`.

| Policy | Roles |
| --- | --- |
| `account-owner`, `opportunity-owner`, `project-owner`, `sales-plan-owner` | Sales, Sales Manager |
| `general-task` | Admin, Sales, Sales Manager, Marketing Manager |
| `support-task` | General Task roles plus Support and Support Manager |
| `support-case` | Admin, Support, Support Manager |
| `trade-show-sales` | Sales, Sales Manager |
| `marketing-owner` | Marketing Manager |

Admin can administer and reassign Sales ownership without becoming a new routine Sales owner. Admin remains a valid Task and Support Case assignee because existing case handling, task assignment, and follow-up workflows explicitly use Admin. Case Tasks retain operational collaborators as well as Support. General CRM Tasks cannot newly be assigned to Support. `taskAssigneePolicy` selects the population from the persisted Task's case link for notification delivery and bulk reassignment. Ownership & Reassignment offers the union of potential Task targets, then checks each selected Task on the server; a mixed general/case selection cannot be assigned to Support.

Existing retained owners/assignees and creator, reviewer, uploader, shipper, or completed-work attribution are not rewritten. Changing between a general and case Task revalidates the assignee against the new context. Sales Plan imports validate current owner eligibility in preview, submitted review, and the serializable finalization transaction. Existing historical plans remain readable with their original attribution.

## Task record policy

Tasks represent work still to do. Activities represent things that happened; Task responsibility restrictions do not become a new ownership restriction on Activity history.

General Task editors use the same `taskEditWhere` for individual saves, edit affordances, archive/restore actions, and bulk scope. Sales may edit only Tasks assigned to themselves. Project-linked Tasks additionally require authority over the Project or its primary Account. Other Sales users' Tasks and unassigned Tasks are not editable by Sales, even though record browsing remains shared. Admin and Sales Manager keep general collaborative access. Marketing Manager keeps general Task access without gaining Project edit rights.

Intentional operation distinctions remain: bulk completion/assignment/due-date operations select only operational, unfinished Tasks and enforce version checks atomically. Individual forms may reopen completed Tasks or restore archived Tasks. Support retains its narrower existing case-Task editor: assigned work, or unassigned work they created, on an available Case, without changing relationships, assignment, or priority. Support bulk access is not added; the unrestricted general bulk operations require `tasks.write`. Support collaboration on Cases and case work creation remains intact.

## User administration and final usable Admin

`submitUser` checks `users.manage` before parsing or persistence. `saveUser(client, actor, input, id?)` independently checks capability, validates and whitelists input, acquires transaction advisory lock `72341001`, locks/reloads the actor, and checks the persisted role/status before writing. Forged role/status/actor form fields cannot supply authority. Identity linking and Google identity reset rules are unchanged.

All application user create/update operations take that transaction lock. Demotion or deactivation of the final active, unarchived Admin is rejected with: “Keep at least one active, unarchived Administrator. Activate another Administrator before changing this user.” Two concurrent changes cannot remove the final pair. Another usable Admin permits emergency deactivation. There is currently no User archive/delete application path; any future path must acquire the same lock and call `assertUsableAdminRemains`, including its next archive state. Direct operator SQL is outside this application invariant.

## Read Only certification

READ_ONLY can reasonably be described as **“No business-record mutation, with explicit personal-preference exceptions.”**

The v1 review covered exported business actions and API mutations: Accounts/Contacts, Opportunities, Projects, Products/SKU pricing, operational Tasks, Activities/Notes, Support Cases and attachments, Trade Shows, Marketing, reports, Sales Plan allocation/import/sync, Administration/imports/maintenance, documents, and calendar-to-Activity conversion. Those paths require a denied capability or a denied record/service policy. Direct action tests cover the Critical user path and representative business writes with a database trap, alongside existing module regressions. Internal automation routes require their separate server secrets; E2E fixture routes remain disabled in production.

Exceptions are restricted to the authenticated user's own state: Saved Views, notifications and preferences, Recent Items, dashboard preferences, timezone, sign-out, and personal Calendar connection/sync state. Calendar sync stores personal provider snapshots; creating CRM Activities from them still requires write authorization. These exceptions do not authorize CRM business-record changes.

## Maintainer rules and retained role checks

Add future role capabilities to the predefined matrix and explicitly choose eligibility populations. Never infer owner/assignee eligibility from a module's edit capability. Add negative direct-call tests, query/output tests for sensitive reads, and record-policy parity tests. Do not broaden shared browsing into owner-only read access.

Direct role checks intentionally remain where they express record responsibility (Sales own-record rules), personal dashboard/filter defaults, report-definition ownership/Admin override, identity impersonation restrictions, or the distinction between an authenticated Admin and the trusted snapshot automation actor. Presentation-only role labels/defaults are unchanged. Snapshot/movement readers and consequential report read/create/share decisions now use named capabilities. Configuration/maintenance modules formerly using `users.manage` now use `configuration.manage` so delegated user administration does not grant configuration access.

The original Authorization Foundation had no schema changes. The approved User Lifecycle extension below adds two migrations, role policies, impact previews, and administration history. User import/export and historical ownership rewriting remain excluded.

## User Lifecycle Administration v1

Eight predefined functional roles are implemented. Roles describe SalesHub responsibilities, not job titles, location, or email domain. A VP carrying accounts normally remains Sales Manager. Executive is a parallel reader role, not a higher Sales Manager.

Support Manager has `support-cases.all.read`, `support-cases.read`, `support-cases.write`, `support-work.write`, `support-oversight.manage`, `support-categories.manage`, `support-inbox.write`, and Account/Contact/Product read. This covers all Cases, assignment, priority, lifecycle correction, team workload reporting, case Task assignment/priority edits, and case Activity work. It does not grant general Tasks, Sales administration, pricing, Marketing, users, system health, maintenance, or integration configuration. Mailbox connection administration uses `support-mailbox.manage`, separate from inbox use. Existing Admin/Support connection rights are preserved; Support Manager receives inbox use only.

Executive has Account, Contact, Opportunity/Pipeline, Project, Task/Activity, Product/catalog, Demo directory, Sales Plan/report/SKU, Forecast, Snapshot, Movement, operational/engagement report, Support Case, Marketing, and Trade Show read capabilities. Shared saved reports remain readable subject to report type. No report-definition management, operational writes, inbox, negotiated pricing (`pricing.read`), configuration, or administration is granted. Existing parent authorization controls Documents and Notes.

Executive can run the permitted built-in reports without saving report definitions. Price Exception Usage execution and shared definitions require `pricing.read`. Opportunity details omit unit prices and pricing provenance without that capability; Product Performance results redact unit-price fields, average unit prices, and pricing provenance before returning data to the browser. Business revenue totals remain readable.

Eligibility remains independent of capabilities: Support Manager joins only `support-case` and `support-task`. Executive joins no operational population. Sales Manager remains in Sales owner, task, quota, target, forecast, and attribution populations regardless of delegated user administration. Historical filters may include prior owners. Shared Sales browsing and effective-user Pipeline defaults remain unchanged.

## Support policy

Support may work any Support Case and may claim/reassign a Case to themselves for continued follow-up. Support Manager may assign/reassign Cases between eligible Support users, bulk assign Cases and change team priorities, manage team case-linked Tasks, correct case Activities, manage categories, archive/restore Cases, and reopen closed Cases. Support can reopen resolved Cases as part of normal follow-up. Both roles may use the Support Inbox. Gmail connection, OAuth, and configuration administration are Admin-only. These boundaries are checked in server actions and services, independently of visible controls.

## User Administration

`User.delegatedUserAdministrationEnabled` is a fixed, optional bundle evaluated only for active, unarchived Sales Managers. It adds only `users.manage`. `configuration.manage` now protects previously overloaded configuration/import/maintenance entry points. Only true Admins may grant/revoke delegation or manage Admin/delegated identities. Delegated managers cannot create Admins, recover Admin/delegated identities, or change their own delegation. Persisted authority is rechecked inside the user-write transaction. Delegated managers never count as true Admins in the final-Admin safeguard.

User changes calculate lost-eligibility impact transactionally before saving, with counts for Accounts, open Opportunities, active Projects, open general/case Tasks, unresolved Cases, actionable Trade Show leads, current Trade Show Marketing ownership, active Price Exception follow-up, outstanding Demos, and current/future Sales Plans/targets. Confirmation is bound to the persisted user, submitted values, and current counts; a changed preview requires acknowledgment again. Ordinary transitions can proceed without reassignment; historical attribution is not rewritten. User archive/delete is still not an application action; any future path must reuse the existing lock and last-Admin guard and the impact policy.

Whitelisted user changes are appended to `AdminMaintenanceEvent` in the same transaction: creation, role, status, email, timezone, delegation, and identity reset. `oldValue`/`newValue` store only those non-secret values. The existing append-only database protections apply. User detail shows the most recent 100 events; older events remain retained in the database. No separate audit table was added.

## User CSV v1

Policy audit: the existing delegated `users.manage` bundle documents individual lifecycle administration and identity recovery, not bulk operations. The conservative v1 boundary is `users.import` for active, unarchived true ADMIN only; `users.export` for active, unarchived ADMIN or explicitly delegated SALES_MANAGER. This does not broaden delegated write authority. Both are centralized permissions, checked at route/action and persisted service boundaries. Other roles and inactive/archived actors are denied.

CSV cannot grant/revoke User Administration Access. Existing delegated users must have delegation removed through the individual form before import can deactivate them or change them away from Sales Manager. CSV uses the shared target restriction, lifecycle impact service, lifecycle writer, and history service. Whole-batch final-Admin validation runs at preview and again inside the atomic Serializable apply transaction under the existing user administration advisory lock. Delegated managers never count as Admins. Signed, actor-bound, 15-minute confirmation binds the uploaded text, current user versions and active work counts; stale reviews fail closed.
