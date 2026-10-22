# System health

`/administration/system-health` is Admin-only and read-only. It shows a connection-backed database check, database name and PostgreSQL version, current size, five largest tables and indexes, approximate table row counts, and applied/failed migration counts. It never displays connection strings, hosts, credentials, or arbitrary environment values. Release Status may display the explicitly configured, validated release SHA and branch.

Object Storage uses a five-second S3 `HeadBucket` request against the configured Spaces bucket. It lists no objects. The page reports Healthy, Not configured, or Problem without rendering SDK error details or credentials.

The notification evaluator and Calendar sync endpoints record a small `ScheduledJobRun` after their existing secret authentication succeeds. Records contain start/completion, status, duration derivable from timestamps, processed and created/resolved counts where available, and bounded generic result/error text. Monitoring write failures do not change the job's business result. An authenticated invocation that fails records Failed; an unauthorized request records nothing.

Health is based on recorded runtime evidence. The latest failed run is Failed. A running, missing, or old run is Stale. A completed successful notification run is Healthy for 48 hours; a completed successful Calendar sync is Healthy for one hour. These centralized thresholds are in `lib/scheduled-job-runs.ts`. The daily notification scheduler and suggested 15-minute Calendar scheduler must be configured separately; a configured schedule without recent evidence remains Stale. No manual run controls are exposed.

Calendar connection/sync status and Support Gmail connection/fetch evidence remain available. The Integration / job history section now reads last actions, last successes and the most recent unresolved failures from the durable ledger without provider polling. Free-form job result/error summaries are not displayed. See [Integration attempt history](integration-attempt-history.md) for coverage, safe categories, recovery, permissions and retention, and [Administration audit and operations](administration-audit.md) for the existing reports.

Weekly Opportunity + Forecast Snapshot automation also appears in scheduled-job health (eight-day stale threshold). Unlike best-effort notification/calendar monitoring, its execution history is required before captures start. Snapshot pages and Maintenance History show exact linked run IDs and safe failures. See [Weekly Snapshot Automation](../../docs/weekly-snapshot-automation.md) for configuration and recovery.

## Release Status

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

Prisma verification compares the source schema hash, build-time Prisma-normalized
schema hash, generated schema, embedded running client schema and pinned client
version, following `release:check`'s alignment approach. Missing files or unsupported
runtime introspection yield Unable to verify; mismatches need attention. No
Prisma generation occurs during a page request.

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
Release Status checks the running environment's evidence. Verification is computed
on each view; no new release-history model or migration was added. Historical
release verification persistence and provider control are outside v1.
