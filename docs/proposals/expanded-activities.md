# Expanded Activities deployment proposal

The Prisma schema change is in `app/prisma/schema.prisma`. The exact forward-only SQL is in `app/prisma/migrations/20260917110000_expanded_activities/migration.sql`. Neither has been deployed.

`Activity.direction` defaults to `NA` for every existing Activity. `outcome`, `nextStep`, and `followUpDate` are nullable. Existing Accounts, Contacts, Projects, Opportunities, Tasks, Notes, and Activities are not updated or deleted. `ActivityContact` starts empty; its foreign keys restrict deletion of either linked record. The application only appends links, so removing a Contact from an Activity cannot erase its history. A linked Contact may later become inactive; the timeline still shows it. New links must point to active, unarchived Contacts belonging to the selected Account.

The Activity Account remains nullable in the database to preserve old records. The form requires an Account for newly entered Activities. The existing `userId` column remains nullable for historical records, while new Activity submissions require a responsible user.

The existing ActivityType lookup remains the source of display names. Running the existing activity-type seed after deployment adds the requested defaults without renaming or deleting the legacy `NOTES` type or any administrator configured types.

## Future combined Timeline

A future read-only Timeline can query Activities and Notes separately for an Account, Opportunity, or Project, map them into a common presentation shape (`kind`, `timestamp`, `summary`, `recordUrl`), and sort by timestamp. The Activity and Note tables, IDs, permissions, and edit flows remain separate. A cross-table cursor or materialized read model should be considered if the history becomes too large to paginate in memory.
