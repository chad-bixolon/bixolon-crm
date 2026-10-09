# Entity search architecture and picker inventory

`EntityPicker` is the standard relationship picker for Accounts, Contacts, Opportunities, and Projects. It calls `/api/entity-search` after two characters and a 250 ms debounce. The service in `lib/entity-search.ts` checks the viewer's permission, applies entity-specific visibility and caller filters in Prisma, and runs exact, prefix, and contains queries with a 25-row cap per tier. Contact, Opportunity, and Project searches also reserve bounded exact and prefix name queries so a large number of linked Account matches cannot hide a direct name match. It ranks the at most 125 returned candidates as exact name, name prefix, word prefix, contained name, then context match; ties sort by display name and ID. The response contains at most 25 results. The shared portal menu caps at 320 px, scrolls internally, flips above the input when needed, and stays within the viewport. Requests are aborted and sequenced so an older response cannot replace a newer query or filter.

## Inventory

| Workflow | Previous behavior | Current behavior |
| --- | --- | --- |
| Contact create/edit Account, Contact list Account filter | Full Account list in form; list filter already used a 20-row server endpoint | Shared remote Account picker; list itself remains server paginated |
| Opportunity create/edit relationships and list filters | Full Account, Contact, and Project option arrays in form; full Account/Project list filters | Remote pickers; selected relationship labels loaded by ID |
| Project create/edit, Opportunity link, Project list Account filter, Project Updates | Full Account and Opportunity options; full Account filter | Remote pickers with relationship and editability filters; existing selections loaded by ID |
| Tasks, Activities, Notes, Calendar Matches | Full work option arrays; client Contact filtering; Calendar Matches Account filter preloaded | Remote pickers; initial linked labels loaded by ID; dependent Account filters |
| Support Cases | Account/Contact search already used bounded server routes, but empty query returned records | Shared remote picker; the legacy Support search route now delegates Account/Contact requests to the same service |
| Price Exception resolution and cleanup | Account route returned unbounded matches; cleanup used full Account dropdowns | Shared remote picker and 25-row search; cleanup bulk and row correction use remote Account results |
| Trade Show lead resolution, routing, import review; Demo context and backfill | Full Account/Contact/Opportunity/Project dropdowns or client filtering | Remote relationship pickers with partner, Account, Project, and Opportunity eligibility filters; historical labels retained |
| Reports and marketing audiences | Full entity filter options | Remote filters; saved selections loaded by ID; report calculations unchanged |
| Admin import review and Sales Plan import | Import algorithms load batch reference data for matching; visible Account/Contact controls filtered those arrays locally | Visible Account/Contact pickers use remote results; batch matching data remains separate from interactive search |
| Account and Contact main lists | Already queried PostgreSQL with pagination | Retained: Accounts order by name then ID; Contacts by last name, first name, then ID |

Small finite option sets such as stages, users, statuses, roles, product categories, and SKUs keep their existing controls. Full entity reads for reports, imports, exact duplicate detection, and page details are data processing or bounded relationship lookups, not picker result menus.

## Search and index design

Each query executes in PostgreSQL with `take` and a stable `orderBy`, including only the relations needed for result context. Account names use the existing name index plus a trigram index for case-insensitive substring search. Contact first/last name and email, Opportunity name, and Project name use trigram indexes because their `ILIKE` contains predicates cannot use ordinary case-sensitive B-tree indexes. Existing foreign key and relationship indexes support parent filters. PostgreSQL `pg_trgm` is created by the migration. The picker does not load all candidates into Node or the browser; only the bounded tier results are ranked in Node.

Search fields: Account name, with city/state displayed; Contact first name, last name, full name, email, and Account name; Opportunity name and participating Account name; Project name and linked Account name. There is no separate user-facing Account number or Project/Opportunity business identifier in the current schema.
