# Dashboard customization

Dashboard layouts contain presentation state only. `RoleDashboardLayout` stores one optional JSON layout per role; `UserDashboardLayout` stores an intentional personal override and the role under which it was saved. System defaults remain in code, so no seed row is required. Saved Report references remain IDs inside layout JSON and are checked against current ownership, visibility, report-type permission, archive status, and viewer data scope every time the Dashboard loads or saves.

Built-in widget metadata is centralized in `lib/dashboard.ts`. Layout input accepts only registered keys, HALF/FULL sizes supported by each widget, and the curated Saved Report styles KPI, Compact Table, and Grouped Summary. Grouped Summary is available only for a report with a configured grouping. The limit is 24 total widgets and 8 Saved Report widgets.

## Manual acceptance

1. Sign in as SALES. Confirm the Sales default, open **Customize Dashboard**, hide and reorder widgets with the arrow controls, add a permitted personal Saved Report, save, refresh, and confirm persistence. Use **Reset to Role Default** and confirm the current role default returns.
2. Sign in as SALES_MANAGER. Save a Pipeline report, open it, choose **Add to Dashboard**, then select KPI, Compact Table, or Grouped Summary (for a grouped report) in customization. Confirm the widget opens the original report and shows only manager-authorized data.
3. Sign in as MARKETING_MANAGER. Confirm only Marketing Summary and own overdue Tasks are default built-ins. Pin a Trade Show report. Confirm Pipeline reports and pipeline widgets are unavailable.
4. Sign in as ADMIN. Open **Administration → Dashboard Views**, change the Sales default, and save. Confirm a Sales user without a personal override inherits it, while a personalized user is unchanged. Reset that user and confirm the new Admin default appears. Use **Restore System Default** to remove the database override.
5. Tamper with a save request by supplying an unknown key, unsupported size, duplicate widget, inaccessible Saved Report ID, or ungrouped report with Grouped Summary. Confirm the server rejects it without persisting. Change a user role and confirm the prior-role personal layout is ignored. Archive or remove access to a pinned report and confirm no report data is exposed.

The desktop layout uses two columns, FULL widgets span both, and the grid collapses to one column below the desktop breakpoint. Reordering always has keyboard-operable Move Up/Move Down buttons; no drag-only interaction is required.
