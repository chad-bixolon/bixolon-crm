# Saved Views

Saved Views are personal bookmarks for operational list filters. Saved Reports remain separate report definitions and output configurations.

The supported routes are Accounts, Contacts, Opportunities, Tasks, Projects, Price Exceptions, Demos, Support Cases, Products, Campaigns, Pipeline, and Calendar Matches. Trade Shows is excluded because its list has only an active/archived tab, without a useful filter model.

The JSON state contains only allowlisted URL query values for each route. Free-text Search is saved because it is a meaningful URL filter; temporary entity picker text is not. Deliberate sort choices are saved. Pagination page number, cursor, offset, page size, modal state, and filter disclosure state are excluded. Applying a view starts at the first page and uses the route's normal filter and permission logic.

Date filters retain the chosen calendar date. A saved "My overdue tasks" view therefore uses a fixed due-through date; a rolling overdue option would require a separate Tasks filter enhancement.

Opportunity Close Period stores `closePeriod=current-quarter` or `closePeriod=next-quarter` as a relative choice. Opening the view later evaluates the quarter at that time in the New York business calendar. An explicit value such as `closePeriod=2027-Q1` always selects that calendar quarter. `closePeriod=custom` stores `closeFrom` and `closeTo` as fixed dates; existing views with only those date fields open as Custom Date Range. Selecting another period clears the custom dates. Close Period counts as one filter, including a custom range with both dates.

Each user owns their views. One view per route can be the default. Opening a bare route applies that view once; an explicit query URL takes precedence. Selecting a view marks it active. Changing a filter labels it Modified without changing the stored view. Views can be renamed, made or cleared as default, or deleted in Manage views.

An Account or Project ID that is archived, removed, or inaccessible is omitted when a saved view is loaded, with a short warning when the view is selected. Other outdated filter values pass through the existing route parser, which handles unknown values. Saved Views never grant record access. On mobile, Search remains visible, Filters stay collapsed until opened, and their active count reflects the applied query.
