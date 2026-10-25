# Optional Module Visibility v1

Administration → Modules is a deployment setting available only to a true Admin through `deployment.manage`. It controls normal availability; it does not grant role permission or change record visibility. A user needs an effectively enabled module, the existing capability, and the existing record policy. Disabling a module preserves its records, documents, notes, saved views, report definitions, dashboard layout, notifications, and recent-item history. Re-enabling restores normal availability without a repair script.

## Module matrix

| Business module | Identifier | Required module | Scope |
| --- | --- | --- | --- |
| Opportunities | `OPPORTUNITIES` | — | Deals, Pipeline, Opportunity entry points |
| Projects | `PROJECTS` | — | Standalone customer initiatives and project work |
| Support Cases | `SUPPORT_CASES` | — | Cases, case work, support reports |
| Support Inbox | `SUPPORT_INBOX` | Support Cases | Gmail intake UI and interactive actions; Gmail connection state remains separate |
| Marketing | `MARKETING` | — | Campaigns, Audiences, lead-source and attribution management |
| Trade Shows | `TRADE_SHOWS` | — | Events, leads, routing, follow-up |
| Demos | `DEMOS` | — | Demo equipment requests |
| Price Exceptions | `PRICE_EXCEPTIONS` | Products | Customer pricing exceptions |
| Products | `PRODUCTS` | — | Catalog and SKU administration |
| Sales Plans | `SALES_PLANS` | Opportunities | Plans, targets, allocation |
| Forecasting | `FORECASTING` | Opportunities | Forecasts, Opportunity and Forecast Snapshots, Pipeline Movement |

Accounts, Contacts, Tasks and Activities, Reports, Administration, User/Profile, My Day, Calendar Matches, Notes, Documents, and Notifications are core or supporting capabilities in v1. Their optional parent links and pickers follow module availability. Reports are a core container; individual report types and saved definitions follow their required business modules. Marketing and Trade Shows are independent, including for Sales users working Trade Show leads without Marketing management. Projects remain available without Opportunities; linked Opportunity sections disappear in that configuration.

Marketing Attribution and Lead Sources reports combine Marketing, Trade Show, and Opportunity records, so those report routes require all three. Audiences with saved Trade Show criteria remain stored and become available again when Trade Shows is re-enabled.

`DeploymentModuleVisibility` is typed by the `DeploymentModule` enum. The approved additive migration creates one enabled row for every identifier. A missing row also resolves to enabled for compatibility. `updatedById` is nullable and uses `ON DELETE SET NULL`; state survives User archival and removal. The service reads the compact configured/effective sets once per request, applies dependencies centrally, and does not persist effective child state. Disabling Opportunities leaves Forecasting and Sales Plans configured Enabled but effectively unavailable. Re-enabling Opportunities restores them. Each explicit Admin choice creates one Maintenance History event with actor and timestamp; dependent visibility changes are explained in that event without implying the child was edited.

## Surface inventory and enforcement

| Surface | Availability behavior |
| --- | --- |
| Desktop/mobile navigation, header New menu, Administration shortcuts | Disabled links are omitted, with empty groups suppressed; capability checks still apply. |
| Dashboard, Quick Actions, contextual create buttons | Module-only widgets and actions are omitted. Hidden dashboard layout entries remain stored. |
| Global Search, Recent Items, Saved Views | Disabled categories/records are filtered at read time. Stored history and definitions remain. |
| Reports | Built-in and saved report types are filtered; execution and export routes enforce availability. Trade Show lead reporting removes Opportunity fields while Opportunities is disabled. |
| Help | Module topics are hidden; the true-Admin Module Visibility topic remains available. |
| Direct pages, server actions, APIs | Proxy and service boundaries deny disabled module pages and mutations. Direct page access uses a neutral unavailable page; API access uses 404-style denial. Document access checks its optional parent. |
| Account, Contact, Project, Demo, Trade Show, Task, Activity, Note, Calendar contexts | Related sections, links, selectors, and relationship APIs follow the optional module state. Existing links stay in storage. |
| Notifications | Existing history remains; disabled module categories are filtered from normal notification views and preferences. |
| Admin Audit and Maintenance History | Business Audit History rows for disabled modules are hidden. True Admins retain Maintenance History evidence, including unavailable-work recovery in disabled modules. Historical events are retained. |
| Admin Data Quality and Ownership | Optional record checks, counts, and rows follow effective availability. Direct issue/type URLs are unavailable when their module is disabled. Mixed archived-link checks pause when an optional parent is unavailable. |

Editing an Opportunity while Products or Projects is unavailable preserves its existing product lines and Project links. The hidden sections cannot be changed through that edit. Historical Product and Price Exception labels remain readable on an Opportunity without exposing their disabled module routes.

The integration and scheduled-job boundary is deliberate. Weekly snapshots, the notification evaluator, Calendar sync, and Support Gmail connection/process configuration are not deleted, stopped, or rescheduled by a UI module choice. Their secret-protected internal routes remain operational. This avoids an Admin presentation choice silently changing historical capture or integration behavior. Notification results from a disabled module remain hidden from normal views; automation policy can be revisited separately with operational review.

For a small deployment, leave Opportunities and Projects enabled and disable the other nine optional modules. Accounts, Contacts, Tasks/Activities, and Reports remain available. Support, Marketing, Trade Shows, Demos, Price Exceptions, Products, Sales Plans, and Forecasting disappear from normal use. Opportunities and Projects keep the basic CRM workflow.

Apply `20261023140000_optional_module_visibility_v1` before deploying code. The migration only adds the enum/table/index/nullable updater foreign key and seeds enabled rows; it does not rewrite business data or preferences. Rollback of an application release should retain this additive table and data. Do not drop it during rollback: a later version can reuse the Admin choices, while older code ignores the table.
