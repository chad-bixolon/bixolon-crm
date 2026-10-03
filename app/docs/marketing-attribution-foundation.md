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

Marketing Manager and Admin manage Lead Source options and Campaigns and may correct first touch, add manual touches, or void mistaken touches. Sales, Sales Manager, and Read Only see attribution only on CRM records their existing permissions let them open. They have no attribution mutation controls or Campaign management route. Server actions use the current effective user, including local impersonation.

## Future work and decisions awaiting Liz

WordPress ingestion is deferred. The `sourceContext`, unique `sourceKey`, and optional JSON `metadata` allow a later form handler to record form name, page URL, UTM values, and referrer without rewriting this model. That handler must set a blank first touch only, then append a Campaign Influence with a stable submission identity.

Final Lead Source categories, Campaign categories/status vocabulary, naming convention, and the priority of future attribution reports await Liz. Current Campaign detail counts cover linked leads, Contacts, and Opportunities, with no pipeline, won revenue, ROI, or first/last/linear/weighted credit model. Historical Trade Show backfill requires separately reviewed rules before implementation.
