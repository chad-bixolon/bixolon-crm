# Data Quality / Cleanup

The Administration page links to a read-only dashboard for Admin users. Each card counts current records matching one review rule. Selecting a card opens a server-side paged list, with a search field and links to existing CRM records. A record can appear in more than one group. The dashboard makes no changes; PE Cleanup remains the place to review Price Exceptions.

## Implemented checks

| Group | Rule |
| --- | --- |
| Accounts without a sales owner | Active, unarchived Account with no owner. |
| Accounts assigned to an unavailable owner | Active, unarchived Account owned by an inactive or archived user. |
| Contacts without an Account | Active, unarchived Contact with no Account. |
| Contacts linked to an inactive Account | Active, unarchived Contact whose Account is inactive or archived. |
| Open Opportunities without an owner | Unarchived Opportunity in an open stage with no owner or an inactive/archived owner. |
| Open Opportunities without an Account | Unarchived Opportunity in an open stage without an Opportunity Account participant. A legacy direct Account link is not authoritative. |
| Open Opportunities linked to an inactive Account | Unarchived Opportunity in an open stage with an inactive or archived participating Account. |
| Open Opportunities without an expected close date | Unarchived Opportunity in an open stage with no expected close date. |
| Projects without a primary Account | Unarchived Project in Planning, Active, or On Hold status with no primary Account. |
| Projects linked to an inactive Account | Such a Project whose primary Account is inactive or archived. |
| Open Tasks linked to archived records | Unarchived Open or In Progress Task linked to an archived Account, Opportunity, Project, or Contact. |
| Activities linked to archived records | Unarchived Activity linked to an archived Account, Opportunity, or Project. |
| Possible duplicate Accounts | Active, unarchived Accounts with identical names after trimming, collapsing whitespace, and ignoring case. |
| Possible duplicate Contacts | Active, unarchived Contacts with identical nonblank email addresses after trimming and ignoring case. |

Counts use database aggregates and duplicate groups use SQL window aggregation. Detail lists fetch at most 25 rows per page. Search is applied by the database. Possible duplicates are review candidates, not errors or merge instructions.

## Deferred checks

- Stage-specific Opportunity fields: stages define open/closed and probability, but no per-stage required-field policy exists.
- Standalone Task or Activity relationship context: existing workflows permit records without a CRM parent, and some tasks belong to Support Cases or Trade Show Leads.
- Broken references: declared foreign keys prevent normal writes from creating references to missing records. An integrity audit should handle bypassed constraints separately.
- Inactive, rather than archived, Task and Activity relationships: inactivity may be intentional historical context; the dashboard flags archived links only.
- Broad fuzzy duplicates: shared names and domains can describe distinct customers or people. This version uses exact normalized signals only.
