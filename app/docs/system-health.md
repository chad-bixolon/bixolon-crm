# System health

`/administration/system-health` is Admin-only and read-only. It shows a connection-backed database check, database name and PostgreSQL version, current size, five largest tables and indexes, approximate table row counts, and applied/failed migration counts. It never displays connection strings, hosts, credentials, or arbitrary environment values. Deployment Status may display the explicitly configured, validated release SHA and branch.

Object Storage uses a five-second S3 `HeadBucket` request against the configured Spaces bucket. It lists no objects. The page reports Healthy, Not configured, or Problem without rendering SDK error details or credentials.

The notification evaluator and Calendar sync endpoints record a small `ScheduledJobRun` after their existing secret authentication succeeds. Records contain start/completion, status, duration derivable from timestamps, processed and created/resolved counts where available, and bounded generic result/error text. Monitoring write failures do not change the job's business result. An authenticated invocation that fails records Failed; an unauthorized request records nothing.

Health is based on recorded runtime evidence. The latest failed run is Failed. A running, missing, or old run is Stale. A completed successful notification run is Healthy for 48 hours; a completed successful Calendar sync is Healthy for one hour. These centralized thresholds are in `lib/scheduled-job-runs.ts`. The daily notification scheduler and suggested 15-minute Calendar scheduler must be configured separately; a configured schedule without recent evidence remains Stale. No manual run controls are exposed.

Calendar connection/sync status and Support Gmail connection/fetch evidence remain available. The Integration / job history section now reads last actions, last successes and the most recent unresolved failures from the durable ledger without provider polling. Free-form job result/error summaries are not displayed. See [Integration attempt history](integration-attempt-history.md) for coverage, safe categories, recovery, permissions and retention, and [Administration audit and operations](administration-audit.md) for the existing reports.

Weekly Opportunity + Forecast Snapshot automation also appears in scheduled-job health (eight-day stale threshold). Unlike best-effort notification/calendar monitoring, its execution history is required before captures start. Snapshot pages and Maintenance History show exact linked run IDs and safe failures. See [Weekly Snapshot Automation](../../docs/weekly-snapshot-automation.md) for configuration and recovery.

## Deployment Status

Admins see a read-only post-deployment check above service health. The effective
user must retain System Health permission while impersonating. No deployment,
provider refresh, snapshot capture, migration, or history write occurs here.

`npm run build` records `release-metadata.json` after generating Prisma. Supply
`RELEASE_GIT_SHA` (full 40-character hexadecimal commit SHA) and optional
`RELEASE_BRANCH` in the build environment to embed fallback identity; the
production Dockerfile also accepts these build arguments. Deployed commit
identity uses the first valid SHA from runtime `RELEASE_GIT_SHA`, then the build
manifest, otherwise displays Unable to verify. Malformed runtime values are
discarded and never displayed; a valid build SHA can still provide the fallback.
Optional runtime `RELEASE_BRANCH` overrides the build branch. Branches must be
1–120 characters, start with an ASCII letter or digit, and contain only ASCII
letters, digits, dots, underscores, slashes or hyphens; invalid values fall back
to a valid build branch or Not recorded. Branch is not required for verification.
The build timestamp is generated at build time, not inferred as deployment time.
Runtime identity never changes this timestamp, schema hashes or migration evidence.
Only the validated SHA and branch are read from the runtime environment for this
panel; malformed values and unrelated environment values are not exposed.
The manifest must travel with the build (the Docker production image copies it).
The resolved SHA is trusted hosting metadata, not an independent source/artifact
comparison. See [deployment configuration](deployment.md#digitalocean-release-identity)
for automatic DigitalOcean identity.

Migration verification reads names, checksums, completion and rollback state
from `_prisma_migrations`, comparing them with the build manifest. Unfinished,
non-rolled-back attempts are failures. Missing expected migrations are pending;
unknown or modified migrations cannot be verified. Counts exclude rolled-back
attempts. This verifies recorded migration state, not manual database drift.

Release metadata generation reads local schema/migration files and package metadata
only. It does not invoke Prisma CLI, load `prisma.config.ts`, resolve `DATABASE_URL`
or connect to a database. The existing Prisma generation helper uses a process-local
placeholder for generation; no database secret is needed during the Docker build.

Prisma verification compares the exact source-file hash and a shared lexical schema
fingerprint against the generated schema, then requires the generated and embedded
running schemas to match exactly and verifies the pinned client/runtime versions.
Lexical normalization ignores layout outside strings/comments while preserving
tokens, token boundaries, literal contents and comments. Format-2 manifests identify
this algorithm; older/unsupported manifests cannot verify. Missing files, malformed
strings or unsupported runtime introspection yield Unable to verify; mismatches
need attention. No Prisma generation occurs during a page request. Migration
verification and runtime-first release identity are unchanged.

Verified requires commit identity, current migrations and verified runtime.
Pending/failed migrations or runtime mismatch need attention. Some proven core
evidence gives Partially verified; none gives Unable to verify. Operational
inactivity does not fail the release. Weekly snapshots use durable job attempts
and snapshot links. Calendar uses its fixed connection-summary grammar (event
counts are not connection counts). Gmail uses configuration checks, stored
connection metadata and existing exact-context unresolved failure history.
Fixture operations do not count as production evidence. Per-connection Calendar
results remain in the existing panels and Integration & Job History.

Pre-deploy: `npm run release:check` validates the local candidate. Post-deploy:
Deployment Status checks the running environment's evidence. Verification is computed
on each view; no new release-history model or migration was added. Historical
release verification persistence and provider control are outside v1.

## Admin wording polish v2

This is a presentation-only mapping of existing results. Release verification,
Prisma/runtime/schema and migration checks, job and integration state calculations,
staleness thresholds, authorization, queries and routes are unchanged.

The main panel retains the overall badge: Verified, Attention needed, Partially
verified or Unable to verify. Each has its own plain-language summary. Database
updates maps Up to date → Current, Migration pending → Pending, Migration failed
→ Failed, with unavailable evidence remaining Unable to verify. Application &
database compatibility displays the existing runtime result with a short action
when it is not Verified. Failure states stay visible with the disclosure closed.

Labels are Deployed version (10-character SHA, full SHA in title and disclosure),
Source branch, Deployed, SalesHub version and Last checked. Deployed continues to
use the build timestamp: no deployment timestamp is inferred or generated.
Technical details preserves exact migration counts/status, the runtime/schema
result, build metadata and SHA, expected Prisma version, running Prisma
client/runtime version, expected source schema SHA-256 and normalized fingerprint.
Hashes are expected build evidence; the existing runtime check still determines
whether source, generated and embedded schemas match. No new verification runs.

Weekly Sales Snapshots, Calendar Automation and Support Email Connection use
business wording. Job summaries still come from the existing jobSummary parser;
Healthy translates its successful/completed results, and failures remain Attention
needed. Unknown connection counts and zero active connections remain explicit.
Calendar connection totals retain the fixed writer grammar and singular/plural
wording. These summaries describe recorded work; the existing cadence-based
service cards still show stale or failed jobs independently. Gmail connection
metadata and unresolved errors remain separate visible evidence.
Successful attempts show one completion timestamp; failed/incomplete attempts keep
attempt and most recent successful completion context. Existing snapshot/history
links, database/file storage checks and native keyboard-accessible details/summary
disclosures remain available. See System Health Help for Admin-facing guidance.

### Validation (2026-10-22)

- Lint and typecheck passed; production `npm run build -- --webpack` passed.
- 68 focused unit checks passed across release-status, release-check,
  build-release-metadata, operational-maturity, integration-attempts, Help and
  system-health-presentation tests. Coverage includes all four deployment summary
  states, visible database/compatibility failures with details closed, exact
  migration evidence, short/full SHA, operational failures and connection grammar.
- 29 distinct Playwright checks passed across release-status, integration-history,
  operational-maturity and admin-audit. Deployment checks cover 1440, 1024, 820,
  768 and 390 px, native disclosure Enter/Space controls, hidden technical evidence,
  full/short runtime SHA, singular/plural connection counts, failed-attempt context,
  safe errors, responsive overflow and Admin-only access.
- The affected browser checks were rerun successfully after updating a legacy
  wording assertion and completing concurrent local Prisma generation. The initial
  generation overlap caused a transient package-read error; no application logic
  was changed to suppress it. Unit subprocess output and Webpack's TypeScript
  configuration read required running outside this host's sandbox.
- Screenshots are retained in `app/reports/system-health-wording/` (ignored).
  Validation used the isolated E2E database and synthetic provider fixtures.
- Diff review confirms unchanged health rules, thresholds, evidence queries,
  permissions, schema/migrations, release tooling and hosting configuration.
  Generated framework edits were restored. No deployment, commit or push occurred.
