# Authorization Correctness & Policy Foundation v1

SalesHub uses six predefined roles: Administrator, Sales Manager, Sales, Support, Marketing Manager, and Read Only. No custom roles, permission overrides, or future roles are implemented.

## Three separate decisions

1. **Capability:** `lib/authorization.ts` owns `predefinedCapabilities`. `can` rejects missing, inactive, and archived actors, then checks the role's explicit capability set. `requirePermission` protects page reads; `requireMutation` protects server actions; `assertPermission` protects services accepting an actor. Existing module permission names remain compatible. No write permission implicitly grants another capability.
2. **Record policy:** after the capability check, persisted ownership, assignment, relationships, and operational state determine whether the actor may change a specific record. Read scopes and edit scopes are independent. `taskEditWhere` and `assertTaskEdit` centralize general Task edit responsibility. Project and Opportunity policies retain their existing ownership rules.
3. **Eligibility:** `lib/assignment-eligibility.ts` defines named business populations, without consulting `can`. `eligibleUserWhere` supplies queries; `eligibleUser` validates selected users. Current eligibility applies to new assignments, not historical attribution.

The request proxy is defense in depth. A protected page does not authorize its exported actions. Do not claim every persistence helper checks authorization: legacy storage primitives such as `saveTaskInTransaction` expect an already-authorized caller. User administration is deliberately stricter: both `submitUser` and `saveUser` enforce authorization independently. Actions must obtain the effective actor from the authenticated server context, never from form fields. Test-as-user uses the effective role; privileged real identities cannot lend capabilities to the effective user.

## Predefined capability matrix

The complete, executable matrix is `predefinedCapabilities`; this table summarizes business access. “Sales roles” means Sales and Sales Manager.

| Area / capability | Current access |
| --- | --- |
| Accounts / Contacts read | All six roles |
| Accounts / Contacts write | Admin and Sales roles |
| Opportunities read | Admin, Sales roles, Marketing Manager, Read Only |
| Pipeline / `sales.read` | Admin, Sales roles, Read Only |
| Sales / Opportunity write | Admin and Sales roles; record policy still applies |
| Projects read | Admin, Sales roles, Marketing Manager, Read Only |
| Projects write | Admin and Sales roles; record policy still applies |
| Tasks / Activities / Notes read | Admin, Sales roles, Marketing Manager, Read Only; Support has case-context access |
| General Task / Activity / Note write | Admin, Sales roles, Marketing Manager |
| `support-work.write` | Admin, Sales roles, Marketing Manager, Support; case and record checks still apply |
| Reports | Report-type read checks remain in `reporting.ts` |
| `reports.engagement.read`, `reports.operational.read` | Admin and Sales roles; preserves existing report reader populations independently of write access |
| `reports.create` | Admin, Sales roles, Marketing Manager; report-type access still required |
| `reports.share` | Admin, Sales Manager, Marketing Manager |
| `forecast.read` | Admin, Sales roles, Read Only |
| `snapshots.read` | Admin and Sales Manager |
| `pipeline-movement.read` | Admin and Sales roles |
| Support Cases read | All roles, with case-context query policy |
| Support Cases write / categories | Admin and Support / Admin only for categories |
| `support-inbox.write` | Admin and Support; Gmail feature flag and real-identity connection checks remain |
| Marketing read/write | Admin and Marketing Manager |
| Trade Shows | Existing read/manage/lead/assign/resolve/route grants retained |
| `pricing.read` | Admin, Sales roles, Marketing Manager, Read Only |
| Products read / write | All roles / Admin only |
| Sales Plans read | Admin, Sales roles, Read Only |
| Sales Plans allocate / manage | Admin and Sales roles / Admin and Sales Manager |
| `users.manage`, `integrations.manage` | Admin only |
| `data-quality.manage`, `system-health.read`, `maintenance.manage` | Admin only |

Ordinary catalog tiers remain available with `products.read`. Customer/ODM price rows (including previous prices, tariff fields, final unit prices, effective dates, and negotiated notes) require `pricing.read`. The Product data loader excludes the customer-price relation from its query for unauthorized actors and returns no customer price rows; the server component also gates the negotiated pricing section. Product maintenance continues to require `products.write`.

## Owner and assignee populations

Every population requires `active: true` and `archivedAt: null`.

| Policy | Roles |
| --- | --- |
| `account-owner`, `opportunity-owner`, `project-owner`, `sales-plan-owner` | Sales, Sales Manager |
| `general-task` | Admin, Sales, Sales Manager, Marketing Manager |
| `support-task` | General Task roles plus Support |
| `support-case` | Admin, Support |
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

Direct role checks intentionally remain where they express record responsibility (Sales own-record rules), personal dashboard/filter defaults, report-definition ownership/Admin override, identity impersonation restrictions, or the distinction between an authenticated Admin and the trusted snapshot automation actor. Presentation-only role labels/defaults are unchanged. Snapshot/movement readers and consequential report read/create/share decisions now use named capabilities. Existing configuration/maintenance modules may retain `users.manage` as a compatible Admin capability pending narrower module changes.

No schema migration, new role, custom role system, affected-work preview, user import/export, infrastructure change, or historical ownership rewrite is part of v1.
