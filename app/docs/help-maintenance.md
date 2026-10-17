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

## Sales visibility, outcomes, and Projects update

The existing `accounts-contacts`, `opportunities`, `forecasting`,
`forecast-categories`, and `forecast-snapshots` IDs remain stable. Shared Sales
visibility is explained separately from responsibility and edit/reassignment
rights. My pipeline and explicit salesperson selection live in Forecasting;
Pipeline links there. The copy distinguishes the standalone Pipeline (includes
open Omitted deals) from the forecast report's open Pipeline total (excludes
them), and acknowledges deliberately saved salesperson filters. Clearing the Owner
selection to My pipeline and applying it restores the effective Sales user’s
scope. A default Saved View can reapply on the unfiltered Pipeline URL, including
the Clear button; Help describes that exception. Changing the Clear/default-view
interaction is a workflow decision intentionally deferred from this copy build.

Opportunities explains Expected versus Actual Close Date, the December 15 /
January 8 example, required close information, optional short notes, legacy
Unknown values, reopening/history, and future analysis without promising new
reports or accuracy scores. Closing/reopening instructions use the existing
`sales.write` section gate; viewing guidance remains available to viewing roles.
Snapshot explanations retain Expected Close Date quarter placement.

The new `/help/projects` topic is in Sales and uses `projects.read`. Its action
section uses `projects.write`; it does not grant any capability. Sources checked:
Project forms/detail tabs, Project roles, Project Updates, relationship services,
and the current schema. Participants are Accounts; there is no direct Project
Contact list. Primary Account is optional, and Project/Opportunity links are
optional and can involve several records. There is no separate milestone
tracker: guidance uses Description, Project Updates, overall dates and Tasks.
Do not add milestone automation, dependencies or reminders to the guide without
corresponding application work.

Contextual links use the existing HelpLink component on the Project list,
detail, create/edit form, Pipeline, and Opportunity detail/form. Search,
styling, topic filtering and Help route behavior are unchanged. The Help tests
check concepts, accessible links, role-aware instructions and four viewport
sizes (390, 768, 1024 and 1440 pixels).

Deferred: forecast-accuracy scores and dedicated win/loss analytics; milestone
tracking beyond the current Project tools; a direct Project Contact roster.
The preexisting Project-only Activity constraint issue recorded in
`opportunity-outcomes.md` is outside this copy update. Activity guidance keeps
the appropriate Account context and makes no new Project-only logging claim.

Validation for this update: lint, typecheck, nine relevant unit-test files,
17 Help/Projects Playwright tests and targeted follow-up checks passed. Help was
checked at 390, 768, 1024 and 1440 pixels. The production Webpack build and
`git diff --check` passed. No schema, permission or workflow changes were made
as part of this Help update.
