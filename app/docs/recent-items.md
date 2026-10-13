# Recent Items v1

## Infrastructure and choices

SalesHub has a Next.js authenticated server layout with a client shell, role-filtered sidebar, Global Search, Quick Create and Notifications. The dashboard already combines My Day, Quick Actions and customizable role/personal widgets. UserDashboardLayout, SavedView, NotificationPreference and User.timeZone demonstrate ordinary per-user PostgreSQL persistence. Existing lifecycle/audit events describe mutations and business history; there is no reusable per-user page-view/access table.

Use one compact header popover, accessible on every authenticated page. Fetch its latest eight eligible records only when opened. Defer a dashboard card to avoid duplication and changing saved dashboard layouts. Keep the eight requested types; Products, Demos, Trade Shows and Notes are deferred because they are outside the core scope of v1.

RecentItem stores userId, an enum entityType, recordId and lastViewedAt, never a cached name or URL. Its unique key prevents duplicates, and its descending user/timestamp/ID index serves a bounded history query. The user foreign key cascades on deletion. Polymorphic target IDs deliberately have no target foreign key: resolving current records handles missing targets without altering eight business schemas.

Keep at most 50 records per user, consistent with Saved Views' existing 50-item bound. Show eight to match the dashboard's compact list patterns. Revisits update the same entry. Each write locks the user's row for the transaction, validates the target, upserts it, and prunes older entries before commit. This maintains uniqueness and the cap across concurrent sessions/devices without changing User.updatedAt or generating business audit events. Each touch advances the last-viewed timestamp by at least one millisecond, preventing ties on rapid revisits or clock drift between app hosts; historical timestamp ties have a deterministic ID fallback.

## Tracking and destinations

A RecentView component mounts only inside a successfully rendered record page. Its server action resolves the effective authenticated user, never accepts userId, and independently validates the record. Server render, Link prefetch, list/search results, search API calls and unsuccessful/missing detail pages do not count. History errors do not interrupt access to the underlying record. No localStorage is used.

Accounts, Contacts, Opportunities, Projects, Support Cases, Price Exceptions and Tasks retain their existing detail destinations and authorization. Activities previously had only a write-protected edit page. V1 adds `/activities/[id]` with `tasks.read` permission, following the existing activity read permissions, and tracks both this read page and the existing edit page. The recent link always uses the read page, including for Read Only users. The header popover clamps its anchored position to the viewport on open, resize and scroll; on phones it uses the available viewport width with 16px margins. Sign out uses an accessible icon on phones to keep header controls compact. Existing edit/mutation guards remain in place. Support can open case-linked Task details under the existing special route rule; its recent Tasks must also have a currently visible, unarchived Support Case. Support has no existing Activity detail/edit grant and Activities are therefore excluded for that role.

## Visibility, performance and cleanup

Every read is restricted to the authenticated user's history, including Admin. The API ignores query userId and returns private/no-store responses. Development impersonation follows existing effective-user behavior and records that effective user's history; no new Admin history browser exists.

Resolve up to 50 references with one projection query per populated entity type (at most eight), concurrently. Select only record ID and display fields. Preserve history ordering after filtering and return at most eight items. Do not query per entry or hydrate business records in the header.

Reuse can(), opportunityScope(), taskScope(), projectReadWhere(), supportCaseReadWhere() and scopedPriceExceptionWhere(). Accounts/Contacts/Opportunities/Projects/Tasks/Activities reuse shared operational filters, including archived/inactive relationship parents. Price Exceptions exclude archived records and honor assigned-salesperson/legacy visibility. Support Cases use their operational read predicate, including unresolved-customer visibility. Closed/completed records remain eligible when the ordinary UI allows them; a business completion status does not itself imply an archived/inactive record. Recent Task scope is conservatively restricted to the sales user's assignment, matching the operational list, even though the existing Task detail page is less restrictive.

Unavailable, archived, inactive, permission-revoked and deleted targets are ignored on every read and cannot be touched while ineligible. Keep stale references until ordinary cap eviction; at most 50 per user means no cleanup job is needed. Do not delete on read, so temporary permission or archive changes do not destroy history. Restored accessible records can reappear with their old last-viewed timestamp.

## Deployment and validation

Forward-only migration: `20261013120000_recent_items`. Do not rewrite existing migrations. Deploy through the existing protected-backup/checksum/migrate workflow before running the new app against production. Development/feature validation uses the isolated saleshub_e2e database; it does not migrate production.

Node unit tests cover validation, private bounded reads, projection batching, permission predicates, target filtering, compound upserts and pruning. Feature Playwright tests exercise real PostgreSQL writes, first view/revisit/order, concurrent cap behavior, session/device persistence, user isolation (including Admin query spoofing), permission changes, archived/inactive/deleted/unresolved targets, all eight actual destinations and 390/768/1024/1440 layouts with keyboard focus, outside click and Escape.

Validation completed on 2026-10-13: lint and typecheck passed; all 151 unit test files passed (final run with two workers); 25 selected Playwright tests passed, covering Recent Items, Global Search, Quick Create, Notifications, navigation and touch/keyboard behavior at 390×844, 768×1024, 1024×768 and 1440×900. Browser screenshots were inspected for phone and portrait tablet placement. Production build and `git diff --check` passed. The new migration was applied only to the isolated test database; production rollout must apply it before serving the feature. No commit was created.
