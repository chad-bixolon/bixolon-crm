# System health

`/administration/system-health` is Admin-only and read-only. It shows a connection-backed database check, database name and PostgreSQL version, current size, five largest tables and indexes, approximate table row counts, and applied/failed migration counts. It never displays connection strings, hosts, credentials, or environment values.

Object Storage uses a five-second S3 `HeadBucket` request against the configured Spaces bucket. It lists no objects. The page reports Healthy, Not configured, or Problem without rendering SDK error details or credentials.

The notification evaluator and Calendar sync endpoints record a small `ScheduledJobRun` after their existing secret authentication succeeds. Records contain start/completion, status, duration derivable from timestamps, processed and created/resolved counts where available, and bounded generic result/error text. Monitoring write failures do not change the job's business result. An authenticated invocation that fails records Failed; an unauthorized request records nothing.

Health is based on recorded runtime evidence. The latest failed run is Failed. A running, missing, or old run is Stale. A completed successful notification run is Healthy for 48 hours; a completed successful Calendar sync is Healthy for one hour. These centralized thresholds are in `lib/scheduled-job-runs.ts`. The daily notification scheduler and suggested 15-minute Calendar scheduler must be configured separately; a configured schedule without recent evidence remains Stale. No manual run controls are exposed.

The operations v1 update adds Calendar connection/sync status and Support Gmail connection/fetch evidence. Free-form job result/error summaries are not displayed. See [Administration audit and operations](administration-audit.md) for status semantics, redaction boundaries, pagination and deferred signals.

Weekly Opportunity + Forecast Snapshot automation also appears in scheduled-job health (eight-day stale threshold). Unlike best-effort notification/calendar monitoring, its execution history is required before captures start. Snapshot pages and Maintenance History show exact linked run IDs and safe failures. See [Weekly Snapshot Automation](../../docs/weekly-snapshot-automation.md) for configuration and recovery.
