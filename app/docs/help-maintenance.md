# Help & Onboarding maintenance

User-facing topics live in `lib/help/topics.ts`. `/help` is the filtered directory;
`/help/[topic]` renders an authorized topic with the shared page layout. Help is
linked from the authenticated account menu. No database or external CMS is used.

To add a topic, choose a stable lowercase, hyphenated object key. Add its title,
summary, group, and short sections. Use the existing `can` permission checks for
capabilities, or `accessPath` for a route with special access rules (snapshots).
Sections can require a write permission so viewing roles don't receive action
instructions. `visibleHelpTopics` uses the effective user and filters on the
server before the directory receives searchable content. Do not add role lists
in Help. Admin sees the complete guide through its existing grants.

Use `<HelpLink topic="support-inbox">Help with Support Inbox</HelpLink>` for
contextual links. The typed ID maps to `/help/support-inbox` through
`lib/help/links.ts`. Never rename a published ID without preserving its URL.
Keep contextual links near decisions that need explanation; avoid adding one
to every field. The directory filter checks visible topic text locally.

Write as if training a colleague. Keep paragraphs short, give a practical
example where useful, and recheck instructions against current screens and
permissions. Avoid developer terminology, promises of automation, and claims
that SalesHub sends email. Run lint, typecheck, `tests/help.test.mjs`, the
relevant existing tests, and `e2e/help.spec.ts`; review its phone, tablet, and
desktop screenshots. Tests check role visibility, URLs, contextual entry points,
and keyboard access. No migration is required.

## Source inventory and v1 scope

Sources inspected and checked against the current UI/services:

- Getting Started: `entity-search.md`, `recent-items.md`, `notification-center.md`,
  `saved-views.md`, `dashboard-role-views.md`, `dashboard-customization.md`, and
  My Day, shell, user menu, and Quick Actions components.
- Accounts/Contacts and Opportunities: existing forms, relationship validation,
  `accounts-contacts-import.md`, `opportunity-pricing-provenance.md`, and
  `opportunity-price-provenance-rollout.md`.
- Activities/Tasks: `activities.md`, normal work forms, Calendar logging, and
  contextual action behavior. Active type choices remain configurable; historical
  inactive choices are retained. The guide does not assume the seed list is the
  live list for every deployment.
- Forecast: `../../docs/opportunity-snapshots.md`,
  `../../docs/forecast-snapshots.md`, `opportunity-forecast-history.md`, and the
  current forecast and snapshot calculation/access rules.
- Support: `support-cases.md`, `support-email.md`, current inbox intake and file
  selection, Case work controls, and outbound logging form/service.
- Pricing: `price-exception-discovery.md`, `opportunity-pricing-provenance.md`,
  current lookup, tiers, Opportunity product pricing, and expiration follow-up.
- Administration: `data-quality-dashboard.md` in the root docs directory,
  `administration-audit.md`, `system-health.md`, `bulk-actions.md`, and the current
  review pages and supported actions.
- Marketing: `trade-show-import.md`, `trade-show-follow-up-tasks.md`,
  `marketing-attribution-foundation.md`, lead routing/conversion, and Campaigns.

These are source material, not user-facing document dumps. Stable v1 guidance
covers current customer/deal work, support email handoff, manual snapshots,
existing event follow-up, and supported administration review. Deferred: WordPress
inbound leads, automatic snapshot scheduling, full Gmail thread reconstruction,
complete field history for all records, revenue attribution, and other proposed
workflows without verified screens. No live functionality is claimed for them.
