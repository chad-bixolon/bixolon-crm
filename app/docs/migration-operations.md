# Migration operations

Run these commands from the repository root (`/opt/bixolon-crm`).

## Database backup

For managed SalesHub production, use the separate job and recovery procedures in
[Backup / restore / rollback readiness v1](backup-restore-rollback-v1.md). The legacy
Compose helper below is local pre-migration tooling; it does not establish managed
production backup coverage or upload to Spaces.

Create and validate a protected PostgreSQL custom-format backup before a migration:

```sh
python3 app/scripts/operations/backup-database.py
```

The default filename is `backups/bixolon_crm_before_migration_<timestamp>.dump`. To identify a backup for a particular rollout, supply a safe label containing only ASCII letters, digits, underscores, or hyphens:

```sh
python3 app/scripts/operations/backup-database.py --label trade_show_routing
```

This produces `backups/bixolon_crm_before_trade_show_routing_<timestamp>.dump` and the corresponding checksum manifest.

## Migration checksum validation

Verify every applied migration checksum and require no pending migrations:

```sh
python3 app/scripts/operations/check-migration-checksums.py
```

For a pre-deployment check, explicitly name each migration expected to be pending. Repeat the argument when more than one migration is expected:

```sh
python3 app/scripts/operations/check-migration-checksums.py \
  --expected-pending 20260923190000_trade_show_lead_routing
```

The command fails if an expected migration is missing, an additional migration is pending, an applied checksum differs from its local SQL file, or the applied migration history is incomplete or rolled back.
