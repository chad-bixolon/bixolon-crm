# Read-only production cleanup audit

`npm run audit:production-cleanup` reads selected PostgreSQL metadata with Prisma `findMany` calls. Its connection requests PostgreSQL `default_transaction_read_only=on` and a one-connection pool. It has no object-storage client and reads only the `Document` metadata table, never file bodies. CSV output uses quoted cells and guards against spreadsheet formulas. Files are private (`0600`) in a private output directory (`0700`); `app/reports/` is Git-ignored.

The 2026-09-25 UTC cutover is context, not a test/real verdict. Strong name or placeholder signals, duplicate matches, creator context, and relationships determine confidence. Risk rises for real-looking parent Accounts, product lines, Tasks, Activities, Documents, Trade Show conversions, shared Reports, and price snapshots. A recommendation is for review only. The script makes no cleanup decisions or database changes.

The report includes a summary, per-category candidate CSVs, deterministic duplicate groups, relationship risk, all Document metadata (with storage-key prefix only), Dashboard saved-Report references, pre-cutover Account context, and imports/leads under flagged Trade Shows. The latter context rows are not automatically called test data. The schema has no last-used timestamp for saved Reports or Marketing Audiences. Product catalog descriptions that say “sample thermal roll” are not treated as test evidence.

Run against local Compose first:

```sh
docker compose exec -T app npm run audit:production-cleanup -- --inspect-target
docker compose exec -T app npm run audit:production-cleanup -- --expect-host db --output /app/reports/production-cleanup-local-YYYYMMDDTHHMMSS
```

The output path must be new and absolute, under `/tmp` or `/app/reports`. `--expect-host` must match the database host shown by `--inspect-target`; neither command prints the URL or credentials. Keep generated CSVs private because they contain customer names and Contact email addresses. Do not commit them.

For a failed audit, add `--debug-safe`. It prints each connection, model query, analysis, and report-file stage. On failure it prints the last stage, an allowlisted error name, validated Prisma/PostgreSQL codes when available, and a fixed description. Raw database errors and their metadata are never printed because they may contain connection details or customer data. The audit still issues only Prisma `findMany` reads through a connection configured with `default_transaction_read_only=on`.

The current local Compose environment targets `db/bixolon_crm`; production uses an external database configured in the DigitalOcean runtime. After the diagnostic change is deployed in a later authorized release, run these commands from the DigitalOcean app console, with `AUDIT_DB_HOST` set to the host shown by the first command:

```sh
npm run audit:production-cleanup -- --inspect-target
AUDIT_DB_HOST="$(node -p 'new URL(process.env.DATABASE_URL).hostname')"
npm run audit:production-cleanup -- --expect-host "$AUDIT_DB_HOST" --debug-safe --output "/tmp/saleshub-production-cleanup-audit-$(date -u +%Y%m%dT%H%M%SZ)"
```

Review the host and database name displayed by `--inspect-target` before the run. The output remains in that console/container's `/tmp`; arrange a separately approved secure retrieval method if the report needs to leave the container. No cleanup, migration, or Spaces operation is part of this audit.
