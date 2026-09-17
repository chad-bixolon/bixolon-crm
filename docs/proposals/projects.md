# Projects and Project Participants — approval proposal

**Status:** schema and forward-only migration staged locally; the live database is unchanged. Keep Prisma and `@prisma/client` at 6.19.3. The exact migration SQL is [migration.sql](../../app/prisma/migrations/20260916050000_projects/migration.sql). Do not deploy until final approval.

## Data model

Use a first-class `Project` with one required primary Account and one required primary role. `ProjectAccount` holds only additional Accounts. `ProjectAccountRole` permits several roles per additional Account without creating duplicate participation. Project roles are a separate enum; no Account business role or Opportunity role is rewritten or inferred.

The staged `schema.prisma` adds these enums:

```prisma
enum ProjectStatus {
  PLANNING
  ACTIVE
  ON_HOLD
  COMPLETED
  CANCELLED
}

enum ProjectPartyRole {
  PROGRAM_OWNER
  END_CUSTOMER
  DISTRIBUTOR
  VAR_RESELLER
  INTEGRATOR
  ISV
  OEM
  SERVICE_PROVIDER
  CONNECTIVITY_PROVIDER
  IMPLEMENTATION_PARTNER
  OTHER
}
```

The staged `schema.prisma` adds these models:

```prisma
model Project {
  id                 Int                  @id @default(autoincrement())
  name               String
  primaryAccountId   Int
  primaryAccount     Account              @relation("ProjectPrimaryAccount", fields: [primaryAccountId], references: [id], onDelete: Restrict)
  primaryAccountRole ProjectPartyRole
  ownerId            Int?
  owner              User?                @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  status             ProjectStatus        @default(PLANNING)
  description        String?
  startDate          DateTime?
  targetEndDate      DateTime?
  archivedAt         DateTime?
  createdById        Int
  createdBy          User                 @relation("ProjectCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  updatedById        Int?
  updatedBy          User?                @relation("ProjectUpdatedBy", fields: [updatedById], references: [id], onDelete: Restrict)
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt
  participants       ProjectAccount[]
  opportunities      Opportunity[]
  tasks              Task[]
  activities         Activity[]
  notes              Note[]

  @@index([primaryAccountId, archivedAt])
  @@index([ownerId, status])
  @@index([status, archivedAt])
  @@index([createdById])
  @@index([updatedById])
}

model ProjectAccount {
  projectId Int
  accountId Int
  project   Project              @relation(fields: [projectId], references: [id], onDelete: Restrict)
  account   Account              @relation(fields: [accountId], references: [id], onDelete: Restrict)
  roles     ProjectAccountRole[]
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt

  @@id([projectId, accountId])
  @@index([accountId, projectId])
}

model ProjectAccountRole {
  projectId  Int
  accountId  Int
  role       ProjectPartyRole
  membership ProjectAccount   @relation(fields: [projectId, accountId], references: [projectId, accountId], onDelete: Restrict, onUpdate: Restrict)
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  @@id([projectId, accountId, role])
  @@index([role, projectId])
}
```

The staged `schema.prisma` adds these relation fields to existing models:

```prisma
// User
ownedProjects   Project[] @relation("ProjectOwner")
createdProjects Project[] @relation("ProjectCreatedBy")
updatedProjects Project[] @relation("ProjectUpdatedBy")

// Account
primaryProjects       Project[]        @relation("ProjectPrimaryAccount")
projectMemberships     ProjectAccount[]

// Opportunity, Task, Activity, and Note (same fields on each)
projectId Int?
project   Project? @relation(fields: [projectId], references: [id], onDelete: Restrict)

// Opportunity additionally
@@index([projectId, archivedAt])
// Task additionally
@@index([projectId, status])
// Activity additionally
@@index([projectId, activityDate])
// Note additionally
@@index([projectId, createdAt])
```

The last block is a placement guide, not one literal Prisma model. Existing relation fields and indexes stay intact. SQL enforces a nonblank Project name, ordered dates, and the rule that the primary Account cannot appear in `ProjectAccount`. Prisma 6.19.3 cannot express those checks/triggers, so they remain in migration SQL. `archivedAt` is independent of status; `CANCELLED` is a business outcome, while archived means hidden from normal lists.

| Code | UI label |
| --- | --- |
| `PROGRAM_OWNER` | Program Owner |
| `END_CUSTOMER` | End Customer |
| `DISTRIBUTOR` | Distributor |
| `VAR_RESELLER` | VAR / Reseller |
| `INTEGRATOR` | Integrator |
| `ISV` | ISV |
| `OEM` | OEM |
| `SERVICE_PROVIDER` | Service Provider |
| `CONNECTIVITY_PROVIDER` | Connectivity Provider |
| `IMPLEMENTATION_PARTNER` | Implementation Partner |
| `OTHER` | Other |

Status labels: Planning, Active, On Hold, Completed, Cancelled.

## Relationships and behavior

| Record | First milestone relationship | Reason |
| --- | --- | --- |
| Opportunities | Optional direct `projectId` | The Opportunity stays its own sales record, with its own participants, roles, stage, products, and pricing. Project membership never populates or changes Opportunity participants. |
| Tasks | Optional direct `projectId` | Project-level work needs assignment and due dates even without an Opportunity. |
| Activities | Optional direct `projectId` | Project meetings and updates may span several Opportunities. |
| Notes | Optional direct `projectId` | Project-level context deserves its own notes. |
| Products | Inferred through linked Opportunity line items | The current product association carries opportunity-specific quantity and price; a separate Project product table would imply a second commercial source of truth. Show distinct products and linked opportunities on the Project tab. |
| Contacts | Inferred through the primary and additional Accounts | Show contact links grouped by Account, without a new ProjectContact table. Defer explicit contact assignment until a use case requires it. |

Direct Task, Activity, or Note links are for project-level records. Records linked to a Project's Opportunities can also appear in the Project detail as **related via Opportunity**, labeled separately; avoid duplicate rows when an item has both links. No automatic backfill or linkage is assumed. If an Opportunity moves between Projects, its own participants and work records remain unchanged. Existing `Activity` and `Note` parent checks are widened to allow a Project parent.

The create/edit service should validate an active primary Account, active additional Accounts, distinct additional Account IDs, at least one role per additional Account, valid dates, and an active owner if selected. Save Project and participant changes in one transaction. On participant removal, delete its role rows and then its membership; the Account row is never deleted. Changing the primary Account requires either removing that Account from additional participants in the same transaction first, or rejecting the edit. The SQL trigger guards this invariant under concurrent writes. Existing linked records block hard deletion through restrictive foreign keys; archive Projects through `archivedAt`.

## UI and reporting

- Add **Projects** to primary navigation, with a searchable list and status, owner, primary Account, participant Account, and archive filters.
- Add **Projects** to Account detail. Query both `primaryProjects` and `projectMemberships`, merge by Project ID, and show whether the Account is Primary or Additional, its project role(s), status, owner, and link. A primary Account appears once.
- Project detail tabs: **Overview** (primary Account, role, status, owner, dates, description), **Participants** (additional Accounts and roles), **Opportunities**, **Tasks**, **Activities**, **Notes**, **Products**. Show contacts grouped by Account in the Overview or Participants view; no separate Contact tab is needed yet. Respect existing archive visibility behavior.
- Project create/edit: name, Primary Account, Primary Account Role, owner, status, start date, target end date, description; a separate **Additional Participants** editor with Account and multi-select roles. Exclude the selected primary Account from the participant picker and show a clear validation error if submitted anyway. Default status to Planning; do not require dates or owner.
- Opportunity create/edit/detail: optional Project selector and link. Opportunity and Pipeline filters: **Project** plus **No Project**, within the viewer's authorized Project scope. Keep existing Account participant filters and pipeline calculations unchanged. Account detail Projects tab offers a link to create a Project with that Account preselected.
- Dashboard: no new KPI in this milestone. A simple recent Projects link/list can be considered later; no Project revenue rollup until reporting semantics are agreed.

## Authorization

Extend the existing permission union and path/action checks with `projects.read` and `projects.write`; use the current session, `can`/`assertPermission`, and server-side query scopes. Do not alter auth architecture. Enforce the same checks on server actions, including archive and participant edits, not just page routes.

| Role | Project behavior |
| --- | --- |
| ADMIN | Read, create, edit, archive/reactivate all Projects. |
| SALES_MANAGER | Read, create, edit all Projects; archive/reactivate according to existing sales write convention. |
| SALES | View all active Projects and create Projects. Edit a Project when they own the Project or its Primary Account. Owning an additional participating Account does not grant edit rights. |
| MARKETING_MANAGER | Read Project overview, participants, dates, and non-sensitive notes/activities where existing task access allows. No Project writes and no new access to sales pricing or pipeline. |
| READ_ONLY | Read Projects and linked content only where existing record permissions allow; no writes. |

For mixed access, a Project detail must not leak restricted Opportunity names, amounts, products, or pricing through tabs or counts. Reuse `sales.read` and `pricing.read` for those sections. Project level notes and activities continue to follow `tasks.read`. Active Project read access must be applied consistently to list, detail, selectors, account tabs, and filters. SALES edit checks must test the Project owner or Primary Account owner on the server, including archive/reactivate actions. An archived Project is visible to SALES only if they pass that edit check; ADMIN and SALES_MANAGER can view all Projects.

## Migration and preservation

Inspected the current four migrations: `20260916005259_initial_crm`, `20260916020000_crm_foundation`, `20260916030000_task_create_idempotency`, and `20260916040000_marketing_manager`. The foundation migration already uses restrictive foreign keys, composite participant keys, and SQL-only checks. This proposal adds two enums, three tables, and nullable `projectId` columns to Opportunity, Task, Activity, and Note. It changes only the Activity/Note parent checks so Project-only records become valid. It does not drop, rename, or rewrite any existing data column or row, infer Projects from existing Opportunities, change Opportunity participation, or modify applied migration files. Existing rows receive `NULL` project IDs and retain all values and relationships.

Primary key `(projectId, accountId)` prevents duplicate additional participation; role key `(projectId, accountId, role)` prevents duplicate roles. The trigger prevents Primary Account duplication. Foreign keys use `RESTRICT` on delete, so participant removal cannot cascade to an Account. Indexes cover Account detail in both directions, Project ownership/status, linked Opportunity filtering, and Project work tabs. A roleless additional membership is structurally possible in SQL; the create/edit service must reject it and remove an entire membership when the last role is removed. An enforcement trigger for role presence would complicate multi-step edits and is deferred unless direct SQL writers are expected.

Approved decisions: enforce at least one role per additional participant in the application/service layer, and use the SALES access rule above. Regenerate the Prisma client, typecheck, test the migration on a disposable database, and obtain final approval before deploying to the live database.
