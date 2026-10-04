# Marketing attribution foundation

## Meanings

- **Lead Source** is the original source category. `LeadSourceOption` is managed by Marketing Manager and Admin. Values can be added, renamed, reordered, activated, and deactivated. Referenced values remain in the database. `Events` is the editable initial value reserved for Trade Show automation through a stable system key. Marketing's other proposed categories are not preloaded.
- **Marketing Campaign** is a named initiative, event, form, or program. Marketing supplies its display name. Year, category, dates, status, and description are optional. A Trade Show has at most one Campaign, shared by its leads. Archiving a Campaign keeps historical touches.
- **Campaign Influence** is one dated touch. It records Campaign, occurrence time, source context, optional metadata and notes, and capturing user. A touch has exactly one origin: Trade Show Lead, Contact, or Opportunity. Touches are added over time. Corrections void a touch with a reason; the row remains. No revenue credit is assigned.

## First touch and record links

An unresolved Trade Show Lead stores its first-touch Lead Source. A linked Contact stores its own first-touch value. Linking a lead sets a blank Contact value but does not overwrite an existing one. A Marketing Manager or Admin can explicitly correct either value with a reason; `LeadSourceChange` retains old and new values, actor, and time. Campaign touches never change first touch.

An Opportunity displays Lead Source from its originating Trade Show Lead and linked Contacts. Multiple different Contact sources can appear together, since choosing one would invent a precedence rule. Opportunity touches are queried from its direct touches, originating lead, linked Contacts, and those Contacts' linked leads. They are not copied during conversion. Opportunity owner scope remains enforced by its detail route. Attribution cards add no record access.

## Trade Show automation

New imported leads get the active `Events` source if their Lead Source is blank. Import creates or reuses the Campaign linked to the show and adds one influence with `TRADE_SHOW_IMPORT` context, captured time when available, and otherwise import time. The unique source key `trade-show-lead:<id>` makes influence creation idempotent. Existing Contact sources are retained. Resolving a Contact carries first touch when blank and makes the lead touch visible through the existing link. Conversion does not copy the influence. Existing routing, assignment, and Contact creation choices remain in place.

The migration adds only the configurable Events default. It does not backfill historical leads, Contacts, Opportunities, or Campaigns. If Events is inactive, new Trade Show imports stop with a clear error until Marketing reactivates it. Import-created Campaign names start from the Trade Show name and can be edited independently. Archived Campaigns keep their historical touches.

## Ownership and access

Marketing Manager and Admin manage Lead Source options and Campaigns and may correct first touch, add manual touches, or void mistaken touches. Sales, Sales Manager, and Read Only can open the read-only Campaign list and detail pages. Linked influence activity and related records follow their existing CRM record visibility. They have no attribution mutation controls or Campaign edit route. Server actions use the current effective user, including local impersonation.

## Lead Sources report

`/reports/lead-sources` derives a canonical prospect set: each unarchived Contact appears once, and each Trade Show Lead without a Contact link appears once. A linked lead is represented only by its Contact, even when several leads link to that Contact. Campaign Influences and Opportunities are never prospect rows. Reimporting an existing Trade Show lead reuses its source key and does not create a second prospect. The report cannot identify two independently created, unresolved leads as the same person without an explicit Contact link.

**Resolved Contacts** have at least one linked Trade Show lead. **Contact-only Prospects** have no linked Trade Show lead. Both are part of Unique Prospects, along with Unresolved Leads. **Contact Share** is the percentage of report prospects currently represented by a Contact; it is not a historical conversion rate.

The Contact's current explicit Lead Source is authoritative for its row. An unresolved lead uses its own current Lead Source. The report never copies or corrects a source. A Contact is flagged for review when any linked lead's current source differs from the Contact's current source, including one side being blank. Corrections to either current source are reflected on the next read; `LeadSourceChange` remains the audit history. An unspecified Contact source stays unspecified even if linked leads have sources.

The date range filters a **report date**, which is the earliest captured or imported date among linked leads whose source matches the Contact's current source, when available. Otherwise it is the Contact creation date. An unresolved lead uses its capture date, or its import date when capture is missing. Detail rows show the date basis. Contact creation is only a fallback, not a verified first-touch date; historical Contacts without provenance may therefore fall in a different period than their actual first touch. Corrections may change which matching linked lead supplies a Contact's report date. No date is fabricated.

Campaign filtering checks for at least one active influence attached directly to a Contact, to one of its linked leads, or to an unresolved lead. Multiple matching influences still select the prospect only once. Voided influences do not qualify. An Opportunity-only influence does not establish a person's Campaign association. Related Campaign names in the detail follow the same rule.

Opportunity association counts distinct, unarchived Opportunities linked through `OpportunityContact` or a Trade Show lead's converted Opportunity. An unresolved lead can retain a converted Opportunity and still be an unresolved Contact lead. Each prospect contributes at most one to **Prospects with Opportunities**, while detail shows its distinct Opportunity count. This indicates CRM association, not Campaign attribution or conversion revenue.

Marketing Manager and Admin can access the report under effective-user authorization. Sales, Sales Manager, and Read Only retain their existing permissions and cannot open it. The report uses server-side grouped SQL and a 26-row fetch for each 25-row detail page. It is read-only and does not change attribution or CRM records. The assigned rep filter and display use Trade Show lead assignment; a Contact with leads assigned to multiple reps has no single report rep. Contacts without linked Trade Show leads have no assigned rep in this report.

Archived Contacts are outside the report population; leads linked to them are not reclassified as unresolved. Historical Trade Show leads with blank Lead Source remain in **Unspecified** until explicitly corrected. No historical backfill or person matching is performed.

## Future work and decisions awaiting Liz

WordPress ingestion is deferred. The `sourceContext`, unique `sourceKey`, and optional JSON `metadata` allow a later form handler to record form name, page URL, UTM values, and referrer without rewriting this model. That handler must set a blank first touch only, then append a Campaign Influence with a stable submission identity.

Final Lead Source categories, Campaign categories/status vocabulary, Campaign naming, and the priority of future attribution reports await Liz. Campaign category remains free text and category/naming may be refined after Marketing feedback. Current Campaign detail counts cover linked leads, Contacts, and Opportunities, with no pipeline, won revenue, ROI, or first/last/linear/weighted credit model. Historical Trade Show backfill requires separately reviewed rules before implementation.
