# Backup / restore / rollback readiness v1

Owner: Chad / SalesHub operations. Evidence review: 2026-10-28. This is operational recovery tooling; no schema migration or backup-history table is required. No production restore, production mutation, deployment, Git write, or DigitalOcean configuration is part of implementation or its tests.

## Current architecture and evidence boundary

Production is the DigitalOcean App Platform SalesHub application, an external DigitalOcean Managed PostgreSQL production database, and a private Spaces document bucket. GitHub `main` is the canonical application source; App Platform auto-deploys it. GitHub-hosted CI validates PRs and main pushes. Main-push CI and DO auto-deployment are independent: **DO can start deploying before main-push CI completes**. Follow branch protection and required PR checks, rather than assuming a GitHub deployment gate exists.

Repository evidence: [deployment](deployment.md), [Hosted CI v1](hosted-ci.md), [System Health](system-health.md), [observability](production-observability-v1.md), [weekly snapshots](../../docs/weekly-snapshot-automation.md), `.github/workflows/ci.yml`, `app/Dockerfile`, and `app/lib/document-storage.ts`. Deployment docs describe one app container and a 22-connection database limit; confirm the live plan before sizing a job. Documents, branding logos, Support attachments and email-file objects use Spaces; PostgreSQL stores their references and metadata. Local Compose PostgreSQL is a separate development resource.

This audit reads repository evidence and current public provider documentation. It does **not** attest to live cluster size/version/ID, backup timestamps, successful past recoveries, current Spaces versioning/lifecycle, current credentials, or whether every proposed scheduler is enabled. No provider account was queried and no production DB was connected. Record those observations in the operator checklist below before claiming live coverage. Existing `backup-database.py` creates local protected pre-migration dumps/checksum manifests from local Compose; ignored `backups/` evidence is not proof that managed production is backed up independently or that anything is off-host.

| Dependency | Existing protection | Recovery dependency / gap |
| --- | --- | --- |
| Managed PostgreSQL | Provider daily backups and WAL/PITR, subject to seven-day window | Live availability and successful restore still need operator evidence; cluster destruction removes its backups |
| App Platform code | GitHub history, hosted CI, recent successful DO deployments | Retain Git/release SHA, app-spec/config inventory and runtime secrets in approved secure storage; ephemeral filesystem is not a backup |
| Document Spaces | Provider storage durability and disk encryption | No built-in backup; live versioning and separate copies unverified |
| New logical backup layer | Custom archive, SHA-256, parse test, upload + full byte read-back | Code is ready for configuration; no bucket, key, job or schedule has been created |
| Secrets and integrations | Runtime secrets and encrypted application values where implemented | Git/dumps cannot recover missing encryption keys or OAuth configuration; preserve key custody separately |

## Provider-native PostgreSQL protection (separate layer)

Checked current DigitalOcean documentation on 2026-10-28: [PostgreSQL features](https://docs.digitalocean.com/products/databases/postgresql/details/features/) describes daily full-cluster backups plus write-ahead logs supporting recovery within the previous seven days. This covers the cluster rather than only SalesHub's database. Standby failover depends on having a standby; do not infer one from using a managed service. Encryption is LUKS at rest and SSL in transit.

The [manual restore procedure](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/) says daily backups are retained seven days, provider-selected backup timing cannot be changed, and a user can select the latest available transaction or a point in time. **Restore creates a new cluster/primary copy; it does not replace the existing primary.** Completion depends on data volume. Cluster quota can prevent creation: request capacity/support rather than destroying a useful cluster. Destroying a cluster also destroys its provider backups. Neither WAL arrival latency nor a fixed restore duration is established here; inspect the actual earliest/latest recovery points during an incident.

This provider layer is not the same as the logical layer below. A dedicated Spaces bucket provides separation from cluster deletion and a portable PostgreSQL archive, but is still within DigitalOcean's account/provider failure domain.

## Logical backup design and integrity

Run `node scripts/operations/backup-postgres.mjs` from `/app` in the separate operations image. It deliberately reads **only** `BACKUP_DATABASE_URL`, never the normal app `DATABASE_URL`, and requires its database name to match `BACKUP_DATABASE_NAME`. It uses `pg_dump --format=custom --compress=6 --no-password --lock-wait-timeout=10s`. There are no table filters, `pg_dumpall`, physical directory copies, production writes or database tracking tables. Schema, application data, extensions' logical definitions and `_prisma_migrations` are included for the selected database. Cluster roles, role passwords, cluster configuration, replication state and object-storage bytes are excluded.

Use a dedicated read-only login with CONNECT on this database, USAGE on application schemas, SELECT on all application tables/sequences and suitable default privileges for future migration-created objects. Grant defaults for the actual owner(s) creating tables; re-audit after migrations. It must not own application objects, be a superuser, inherit writer/owner roles, or have CREATE/INSERT/UPDATE/DELETE/TRUNCATE privileges on application schemas/tables. Review PUBLIC grants too. No CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS capability is needed; insufficient access must fail rather than silently omit data. The job also sets `default_transaction_read_only=on`, a 20-minute statement timeout and 10-second lock timeout. On DO, have an authorized DB administrator review the specific grants; this build applies none.

The script:

1. Validates DB identity, TLS, dedicated bucket separation, regional HTTPS endpoint, runtime credentials, size cap and safe environment/version labels.
2. Checks available temporary space against the configured cap plus 256 MiB, then creates a private unique directory in `BACKUP_TEMP_DIR` (default `/tmp`). A runtime CA PEM, if provided, lives there too.
3. Streams the custom dump to a mode-0600 local file; aborts if bytes exceed the configured cap. Uses a process argument array and libpq environment variables, without shell interpolation or a connection URL/password in argv. Inherited PG service/options and other runtime secrets do not reach the child.
4. Confirms nonzero size, parses it with `pg_restore --list`, and calculates SHA-256.
5. PUTs a private object, HEAD-checks length and checksum metadata, then GETs and hashes **all remote bytes** against the local checksum/length. ETag is not used as a SHA-256 substitute.
6. Removes the temporary directory on success/failure before emitting a terminal success. Any failed tier, upload, integrity check, command or cleanup exits nonzero without `backup.completed`.

Upload read-stream errors are handled before SDK consumption, abort the HTTP request and return a fixed local-temp failure so normal cleanup still runs. SDK exception payloads are not propagated. A missing PostgreSQL executable also exits promptly: the command timer is explicitly cleared on spawn error/close rather than relying on Node's built-in spawn timeout, which can survive a failed spawn without an exit event.

Parsing an archive proves only readable archive structure. A full restore drill is required to establish that schema/data can be restored. Matching SHA-256 proves transfer integrity against the recorded digest, not authenticity against an attacker who can rewrite the dump, metadata and logs. Preserve the digest in a restricted incident/evidence record as well as object metadata.

Custom archives also support `pg_restore --table`, `--schema` and `--use-list` for selective inspection/extraction into isolated databases. Review dependency ordering and foreign keys before extraction; do not send selective restores directly to production.

Object keys have this form (a UUID prevents concurrent/retry collisions):

```text
postgres/daily/saleshub-prod-2026-10-28T020000Z-<run-uuid>.dump
postgres/weekly/saleshub-prod-<UTC-timestamp>-<run-uuid>.dump
postgres/monthly/saleshub-prod-<UTC-timestamp>-<run-uuid>.dump
```

Metadata records environment, database, timestamp, full Git SHA when provided (otherwise `unknown`), `dump-format=custom`, pg_dump version, `metadata-version=1` and SHA-256. The archive contains its PostgreSQL archive version internally. Restore with the matching/newer `pg_restore`, preferably the same server major as the source. The operations image supplies PostgreSQL **17** client tools; **verify the actual managed server major before activation**. PostgreSQL clients cannot dump a newer server major. A major-version change requires image/tool review and another drill.

## Destination, credentials and runtime configuration

Use a **dedicated private Standard Spaces bucket**, separate from the normal documents bucket; no CDN, public listing, public objects or signed download links. The script always requests private object ACLs and rejects the known document bucket. Operators must supply the real document bucket via `BACKUP_DOCUMENTS_BUCKET`; an incorrect inventory cannot be detected without account access. Do not attach backup credentials to the web service, HTTP snapshot trigger job, CI, build arguments or repository.

| Variable | Use |
| --- | --- |
| `BACKUP_DATABASE_URL` | Backup-only secret: direct cluster connection to the single SalesHub database, URL-encoded login/password, `sslmode=verify-full`; avoid transaction poolers |
| `BACKUP_DATABASE_NAME` | Exact selected application DB name; no unrelated DBs |
| `BACKUP_PG_CA_PEM` | Provider CA certificate as runtime multiline PEM; materialized privately and removed with the dump. Alternatively use a pre-provisioned public CA path via URL `sslrootcert=/absolute/path` |
| `BACKUP_ENVIRONMENT` | Exactly one code-owned label: `prod`, `staging`, `dev`, `test`, `drill`; production uses `prod`. Never use customer names or credential values |
| `BACKUP_DOCUMENTS_BUCKET` | Actual existing document bucket, used to enforce destination separation |
| `BACKUP_SPACES_BUCKET` | Dedicated backup bucket name |
| `BACKUP_SPACES_REGION` | Actual bucket region, e.g. `atl1` |
| `BACKUP_SPACES_ENDPOINT` | Exactly `https://<region>.digitaloceanspaces.com`, never CDN/custom URL |
| `BACKUP_SPACES_ACCESS_KEY_ID`, `BACKUP_SPACES_SECRET_ACCESS_KEY` | Backup-scoped runtime secrets; explicit credentials, no fallback to normal app/AWS keys |
| `BACKUP_TEMP_DIR` | Controlled writable directory, default `/tmp` |
| `BACKUP_MAX_DUMP_BYTES` | Default 1073741824 (1 GiB), maximum 2147483648 (2 GiB); hard output cap and free-space preflight |
| `RELEASE_GIT_SHA` | Optional validated 40-character lowercase Git SHA; map `${_self.COMMIT_HASH}` for source-built job |

The URL parser accepts PostgreSQL URI syntax and only `sslmode`, `sslrootcert`, `schema`, `connection_limit`, `pool_timeout`. Prisma-only parameters are discarded for libpq. Raw whitespace/control characters, duplicate query parameters, keyword/value conninfo, URL `options`, host/service overrides, Unix socket hosts and multi-host strings are rejected. Encode legitimate username/password/path characters inside the URI; never add surrounding whitespace. Host casing, encoded hosts, trailing DNS dot, numeric IPv4 aliases and IPv6 spellings are canonicalized before guard comparisons. Existing production app configuration is not rewritten.

Keep `NODE_DEBUG` and `NODE_DEBUG_NATIVE` **unset** in operational jobs and drill environments; any nonempty value fails configuration before PostgreSQL or Spaces client calls. Node's child-process/HTTP debug output can print environment values and signed headers outside the structured logger. Do not use diagnostic preload/inspector tooling or arbitrary debug wrappers with production credentials. Child errors are reduced to fixed stage/message values without raw argv, SQL or nested causes; pg_dump version metadata records only the numeric version. Object keys and their logs accept only the code-owned environment labels above; database metadata is the operational database identifier, not business-record content.

[Spaces access documentation](https://docs.digitalocean.com/products/spaces/how-to/manage-access/) supports a limited key scoped to individual buckets, with Read or Read/Write/Delete permissions. For backups choose **only the backup bucket**, using the smallest supported writing level (currently Read/Write/Delete). This coarse level includes delete even though the code never deletes remote backups. It is not immutable or a true append-only key. Limited keys and `PutBucketPolicy` bucket policies are incompatible: do not suggest combining them for finer write-only controls. Keep a separate Read key for restore drills. Lifecycle configuration belongs to the operator's administrative credential, not the running job.

Store source backup login, Spaces keys and application decryption keys in approved secret custody with rotation/recovery ownership. A dump includes sensitive business data and encrypted OAuth values; successful decryption still depends on keys stored outside the DB. Restore tooling does not need the production password: use a passwordless production identity URL for the guard.

## Schedule, retention and capacity

Recommend the existing **App Platform SCHEDULED Job** mechanism, rather than a web endpoint, interactive action, CI workflow, server cron on the development host or a deploy hook. Exact schedule: **daily at 02:00 UTC**, cron `0 2 * * *`, `time_zone: Etc/UTC`; runtime command **`node scripts/operations/backup-postgres.mjs`**, working directory `/app`. It is **21:00 EST (UTC−5)** or **22:00 EDT (UTC−4)** on the preceding Eastern calendar date. UTC stays fixed; the local hour changes with DST, without a skipped or duplicate invocation. This is separated from weekly snapshots Monday 05:00 America/New_York (09:00/10:00 UTC). Source: [scheduled jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/).

This review establishes **no known weekly heavy-job overlap**, not a live zero-overlap guarantee. Calendar sync's suggested 15-minute cadence can coincide at 02:00 when configured on quarter hours; notification evaluation is daily with no authoritative execution hour in the repository. Actual enabled schedules/imports/maintenance and execution durations were not queried. Before activation, inventory those in App Platform, confirm connection/resource headroom for light polling overlap, and offset another approved schedule if measured contention warrants it. Provider backup timing cannot be chosen here. Keep the 02:00 UTC recommendation subject to that acceptance check; no scheduler was changed by this review.

Build the job with `app/Dockerfile.operations`, source directory `app`, using the same reviewed Git revision as the deployment. This separate image includes Node 22.23.4, Prisma 6.19.3, pg_dump/pg_restore/psql 17 and the operation scripts. npm 12.2.1 is used only in its dependency-install stage; the final image excludes npm/npx/node-gyp and runs Node/Prisma directly. A small separate manifest/lockfile under `scripts/operations/recovery-runtime/` pins only AWS S3 SDK, Prisma and configuration dependencies, avoiding a Next.js installation for the job. Its Prisma versions and deepmerge override match the main app; maintain both locks during dependency reviews. The web production image does not acquire backup credentials or PostgreSQL client tooling.

Suggested job fragment for **later operator review**, not an applied app spec:

```yaml
jobs:
  - name: postgres-logical-backup
    kind: SCHEDULED
    # Preserve actual repository, branch, resource settings and network/trusted sources.
    source_dir: app
    dockerfile_path: app/Dockerfile.operations
    run_command: node scripts/operations/backup-postgres.mjs
    schedule:
      cron: "0 2 * * *"
      time_zone: Etc/UTC
    # Add runtime-only variables/secrets from the configuration table.
```

Set a 30-minute platform job allowance. The CLI aborts after 25 minutes and attempts cleanup on SIGINT/SIGTERM; PG commands also have timeouts and storage has connection/request timeouts. Run one scheduled job, and avoid overlapping manual retries. Unique names keep retries from overwriting backups; they do not serialize cross-container jobs. If a run is still active, investigate before starting another.

Every run writes daily. On **Sunday UTC**, that same dump is also uploaded and independently verified under weekly. On the **first UTC date of a month**, it is also uploaded/verified under monthly. Sunday/month-start may produce three objects with identical contents/checksum. One start and one terminal log event cover the run; a partial tier failure can leave usable private objects but the whole run is failed. Inspect and retry; no custom deletion code removes these objects.

| Prefix | Proposed retention | Approximate steady-state full-dump copies |
| --- | --- | --- |
| `postgres/daily/` | 30 days | 30 |
| `postgres/weekly/` | 84 days (12 weeks) | 12 |
| `postgres/monthly/` | 366 days (at least 12 calendar months; day-based approximation) | 12–13 |

About **55 times one compressed dump size**, plus growth/retries, is a useful planning estimate. For example, 100 MiB archives use roughly 5.4 GiB. This is a reasonable initial small-CRM proposal, **not a size assessment of the live DB**: record the first verified dump size/runtime, retention cost and monthly growth; review after 30 days and quarterly thereafter. Longer retention also keeps deleted personal/business records longer; align approved retention requirements.

[Spaces lifecycle rules](https://docs.digitalocean.com/products/spaces/how-to/configure-lifecycle-rules/) support time-based expiration by prefix and incomplete multipart cleanup. Later, an operator can inspect/export existing lifecycle configuration and add/review three enabled rules with the exact prefixes and day counts above; do not replace unrelated rules. Lifecycle changes require separate approval. No lifecycle, retention deletion script or object deletion is installed here. If versioning is chosen, review noncurrent-version retention separately so expiration does not just accumulate old versions. The v1 uploader is a bounded single PUT, with no multipart uploads to abandon.

The [App Platform filesystem limit](https://docs.digitalocean.com/products/app-platform/details/limits/) is 4 GiB and storage is ephemeral. Budget **one maximum compressed dump + 256 MiB reserve**, plus the image/runtime footprint; remote read-back streams without storing another copy. Default cap is intentionally conservative. A free-space check cannot prevent another process filling disk later, so streaming limits and finally cleanup remain necessary. SIGKILL, host loss and power loss cannot execute cleanup; ephemeral job termination removes its filesystem. On persistent hosts inspect/remove only identified stale `saleshub-recovery-*` job directories under incident control, never prune unrelated Docker data. If measured dumps approach the cap/filesystem ceiling, move the job to an approved larger operational runner or design bounded streaming/multipart separately; do not silently raise caps or rely on persistent app disks.

## Observability and failure handling

Operational logs use the same JSON envelope as [Production Observability v1](production-observability-v1.md): timestamp, level, event, message, runId, durationMs, and safe operational fields. A separate small operational allowlist permits archive key, size and SHA-256 without broadening the web logger's allowlist. Events are `backup.started/completed/failed` and `restore.started/completed/failed`; successful daily runs emit two lines, not per-row or per-chunk output. PostgreSQL stderr, SDK responses, arbitrary exceptions, DB URLs, passwords, keys, CA contents and signed URLs are never logged. Metadata fields are not copied into logs.

Failure stage distinguishes configuration, temp-space, temp-limit/local temp I/O, pg-dump, archive parsing, checksum, spaces-upload, spaces-verification, download, target-guard, target-not-empty, restore, validation and cleanup. Exit status is nonzero on any failure. SIGTERM may report the active stage; abrupt termination may leave only `started`, which must be treated as incomplete. A completion means uploaded objects passed the stated checks and local cleanup finished; it does not mean a full restore ran.

In App Platform, select this Job's runtime logs/exit status, rather than the web component's logs. No new System Health widget or persistent job table is added; the existing page cannot claim backup freshness from these logs. Before enabling daily operations, assign an owner to check each run and alert on job failure **and missing completion for 26 hours** using an approved external monitor/log destination. This build installs no external alert service; retention/indexing of runtime logs remains limited. Preserve completed-event key/digest/size/time/version and restore-drill evidence securely outside transient logs.

## Safe logical restore procedure

`restore-postgres.mjs` downloads a known private object, checks its metadata length/digest, hashes all downloaded bytes against a separately supplied expected SHA-256, parses it, then restores with `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction`. It never defaults to `DATABASE_URL`, creates databases, or drops a database. It does not restore cluster users/permissions. Only use trusted archives; restore can execute SQL from an archive, so use an isolated runner with no production secrets, external integration credentials, document bucket access, or routable network where practical.

Required variables in addition to the backup **Spaces** configuration (use a separate Read key):

| Variable | Required value / safeguard |
| --- | --- |
| `RESTORE_TARGET_DATABASE_URL` | Explicit disposable target; v1 allows only `localhost`, `127.0.0.1`, or `::1`, a non-default port (not 5432), and DB name `saleshub_restore_<lowercase_suffix>` |
| `RESTORE_PRODUCTION_DATABASE_URL` | Required actual remote production identity URL, optionally passwordless, e.g. `postgresql://identity@<actual-production-host>:25060/<actual-db>`; never used for a connection. Missing/malformed/local/wildcard identities fail closed |
| `RESTORE_OBJECT_KEY` | Exact validated archive key from completed-backup evidence |
| `RESTORE_EXPECTED_SHA256` | Exact 64-character lowercase digest from trusted backup evidence; do not merely trust freshly downloaded object metadata |
| `RESTORE_CONFIRM` | Exactly `restore-disposable-database` |
| `RESTORE_MODE` | `empty` (default) or `clean` |
| `RESTORE_ALLOW_CLEAN` | Only for clean mode: exactly `replace-disposable-objects` |

The guard rejects all remote targets, rejects loopback/wildcard production identities, and compares supplied app/backup connections after canonicalizing host/port/database spelling. Both loopback families, common localhost aliases and wildcard identities are conservatively equivalent for protected-connection comparisons. An allowed `localhost` target is connected as numeric `127.0.0.1`; it never relies on a DNS/hosts-file lookup. Target IPv6 loopback connects only to `::1`. The configured production identity is operator inventory, not an authenticated discovery of the live cluster.

**Do not point a loopback tunnel/proxy at production**: no URL heuristic can identify a remote upstream behind that local listener. Verify container/network/port ownership and use a fresh isolated PostgreSQL instance. Remote production aliases cannot qualify as restore targets; a deliberate/local proxy or privileged host compromise remains outside what a URL guard can prove. V1 offers no general remote-cluster restore override; managed-cluster cutover is a separate approved incident operation.

Prepare a new isolated PostgreSQL server/database (same major and required extensions), with no development/prod volumes. Set the runtime values above through secret injection, then run from `/app` with PostgreSQL tools available:

```sh
node scripts/operations/restore-postgres.mjs
node scripts/operations/validate-restored-postgres.mjs
```

Empty mode checks for non-system tables/views/sequences before writing and refuses a populated target. The transaction fails atomically if unexpected objects conflict. Do not allow other writers during restoration. For a deliberately disposable previously restored DB, set clean mode plus both confirmations: `--clean --if-exists` replaces archive-listed objects inside the same transaction. It does not promise removal of objects not in the archive. Prefer a fresh disposable DB for a definitive drill. Neither mode issues DROP DATABASE or permits a production target.

A client interruption can occur just after the server commits: a reported failure does not prove that no target objects were restored. Inspect the disposable target before retrying; use a fresh DB or deliberately confirmed clean mode. Never infer production cutover readiness from a terminal event alone.

## Restore drill and post-restore validation

Run the synthetic drill locally with Docker, from the repository root:

```sh
docker build -f app/Dockerfile.operations -t saleshub-recovery-ops:local ./app
node app/scripts/operations/restore-drill.mjs
```

Use Node 22.23.4 and the **local Unix Docker socket `/var/run/docker.sock`** for the host command. The harness pins that socket, strips Docker context/remote host and host DB/cloud credentials from the Docker client's environment, and does not fall back to a remote daemon. Other sockets/platforms need a separately reviewed harness adaptation. It starts a uniquely named container from that image, `--network none`, no published ports, capped resources, tmpfs PostgreSQL data and tmpfs scratch. It mounts only the operation scripts read-only. It creates fresh `saleshub_fixture` and `saleshub_restore_drill` DBs inside that container; existing host/dev/prod DBs and volumes are never selected. It finally removes only its own named container and anonymous resources. It does not read host `.env` or forward host credentials. The fixed fixture passwords have no authority elsewhere. Fixture failures and forwarded child diagnostics are sanitized; raw SQL, exception objects and arbitrary JSON fields are not printed.

The drill deploys the full Prisma migration chain into its synthetic source, inserts representative fixture records, grants a SELECT-only backup identity, proves that identity cannot CREATE/ALTER application tables or INSERT/UPDATE/DELETE rows, and uses a self-signed local CA with **verify-full TLS** for the real pg_dump. It exercises daily/weekly/monthly object writes/read-backs through an in-memory object-store adapter, downloads, verifies checksum and pg_restore parsing, restores with real PostgreSQL, checks counts/relationships/sequences through Prisma, checks `prisma migrate status`, refuses a nonempty target, then exercises explicitly confirmed clean restoration and temp cleanup. No DO access is needed. This establishes the PostgreSQL restore path with synthetic data; the adapter does **not** prove live Spaces permissions/networking.

After the first configured production backup, run an **operator-supervised real-backup drill** at least quarterly and before an incompatible migration:

1. Select a known completed object and record timestamp, version, size and trusted digest. Inject only backup-bucket Read credentials and a passwordless production guard identity into the isolated restore runner; do not inject production DB credentials.
2. Download through the restore script into a fresh isolated loopback target with no outgoing integration access. Its steps prove existence/nonempty content, trusted checksum equality and readable archive before restoring. Keep the dump/data private and clean up the disposable server afterward.
3. Run the aggregate validator above. Critical tables must exist; it reports Users, Accounts, Opportunities, Projects, Price Exceptions, Support Cases if present, latest completed migration and unfinished migration count. Counts need only be plausible for the selected snapshot; **do not hardcode production row counts**. A zero count can be legitimate and is not automatically rejected. If Support is enabled but its table is absent, fail the drill; compare expected schema/module inventory.
4. In an isolated runner at the **archive's application revision**, inject only the restored target as `DATABASE_URL`, then run `node node_modules/prisma/build/index.js migrate status`. Expect no failed/pending/divergent migrations at that revision. An older backup checked against current main may correctly show pending newer migrations: record that difference, restore/test at the matching revision, then assess reviewed forward upgrades separately. Do not run `migrate deploy`, `reset`, `resolve` or `db push` simply to make a drill's status look green. Migration names alone do not prove checksums/schema parity; use the existing checksum checker adapted under explicit disposable-target review or System Health's checksum/client verification in the isolated app.
5. Compare critical relationships and sample non-sensitive aggregates; confirm migration checksum/currency and generated Prisma compatibility. Counts are structural sanity, not reconciliation or proof every row is correct.
6. Where practical, start the matching SalesHub application connected only to the restored DB, with test authentication, test-only object storage, outgoing network blocked and all schedulers/Google Calendar/Gmail/notifications disabled. Confirm a representative read and Admin System Health migration/client status. Do not send email, sync external services or grant this test app document-production credentials. The automated synthetic drill proves Prisma connectivity/relations, not an authenticated UI run against real production data.
7. Record operator, source key/digest/version, chosen restore point, elapsed download/restore/validation times, results and shortcomings in the restricted incident/drill record. Remove temporary data/container and revoke time-limited credentials. Measure RTO from incident start, not just pg_restore runtime.

## Application deployment rollback

Canonical model: identify the **last known-good Git commit** from System Health's deployed SHA, GitHub checks and DO deployment history. Preserve the bad deployment SHA and incident evidence. Confirm schema compatibility with the proposed older app before changing code.

For an application-only defect, prepare a reviewed revert commit on a recovery branch targeting main. Use `git revert <bad-commit>` (or `git revert -m 1 <merge-commit>` after reviewing merge parent semantics); for several commits, review/revert the relevant application changes in dependency order. Do not reset/force-push main. Keep already-applied Prisma migration files and their checksums present even when reverting application code. A broad revert that removes applied migrations can make migration history diverge and is not an ordinary application rollback.

Let normal required PR CI and branch protection validate the recovery commit, merge through the established process, and let DO auto-deploy main. Verify the new revert SHA in System Health, Database updates Current, application/database compatibility Verified, `/api/health` and representative authenticated reads. `/api/health` alone does not query PostgreSQL. Watch runtime errors/jobs. Record the selected good behavior and deployed rollback SHA; a revert commit has a new SHA. No Git operations or deployment are performed during this build.

For urgent containment, [DO deployment rollback](https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/) can select one of ten recent successful deployments in Activity, subject to the provider's region/database-resource/configuration constraints. It restores code/config/app spec, **not database data**. Review the settings diff, old secret bindings and schema compatibility; obtain explicit incident approval before changing DO, including any temporary auto-deploy pause. A redeploy/restart of the same bad revision does not fix bad code. Then promptly repair main via a reviewed Git revert/fix and restore the normal deployment configuration so production again corresponds to main. Treat manual drift as time-bounded containment, not the routine release model.

## Forward-only migration recovery policy

Prisma migrations are generally **forward-only**. No automatic down migration is generated. Keep applied SQL/checksums immutable. Prefer expand/contract, delay drops/renames until both old/new app versions are compatible, rehearse destructive changes with a verified backup and restore drill, and record an explicit recovery/cutover plan before release.

| Incident | Response |
| --- | --- |
| Application-only defect | Reviewed application revert and normal redeploy |
| Additive/backward-compatible migration + app defect | Revert app only if old code works with the new schema; retain applied migrations |
| Failed/partial migration | Stop repeated deploy attempts; inspect migration history/transaction outcome using the migration runbook; prepare reviewed forward repair and use Prisma resolve only with evidence of actual schema state |
| Destructive/incompatible migration | **Do not blindly revert code.** Contain writes; assess forward-fix migration versus independent logical/PITR recovery and new DB/cluster cutover |

An app revert cannot reconstruct dropped columns/rows or undo a bulk update. A logical archive may lose all changes after its snapshot if used for whole-DB replacement. A full PITR recovery also discards later legitimate writes unless reconciled. Use a new DB/cluster, validate, then intentionally decide extraction versus cutover. [Migration operations](migration-operations.md) remains the reference for migration/checksum evidence; its old Compose backup is not the managed-production backup command.

## Accidental data change or deletion

For accidental row deletion, wrong bulk update, bad import or an admin/user mistake, preserve exact incident times (UTC), affected IDs/import source, audit/change history and deployment evidence. Stop the offending job/import or contain the write path under incident authority. Avoid repeated attempts that expand damage.

Prefer application-supported manual correction when a small set of intended values is reliably known. Otherwise restore a suitable logical backup **separately**, or use PITR just before the incident into a new cluster. Compare affected records and relationships to current production; extract only the necessary rows/columns into a protected staging artifact. Have an operator review identity collisions, foreign keys, audit history, cascades, unique constraints, sequences and legitimate writes since the recovery point. Stage a transaction with explicit IDs, dry-run counts, before-image evidence and verification, then request separate approval for any production correction. V1 automates none of that production write. Do not replace the whole production DB to fix a few rows.

## High-level provider PITR runbook

This is a manual incident procedure based on the current provider behavior above. It requires explicit approval for DigitalOcean resource creation/configuration; do not invoke it merely to test this implementation.

1. Identify incident start and choose UTC recovery time **before** the damaging transaction (not just before detection). Inspect the available seven-day window and earliest/latest recoverable transaction. Record uncertainty and test candidate times if needed. Confirm quota/cost, region, source cluster identity and snapshot availability; preserve the original cluster/backups.
2. In Databases → production PostgreSQL → Actions → Restore from backup, select latest transaction or the chosen point in time, give the new cluster a clear recovery/test name, and choose **Restore to New Cluster**. Never destroy the original to free quota; request an increase/support instead.
3. Keep the new cluster isolated: restrictive trusted sources, no application traffic/jobs, new recovery credentials as appropriate. Record actual recovered time, server/extension versions and encryption/CA settings. Verify schema/migrations/checksums, representative counts, affected rows and application compatibility at the corresponding revision.
4. Prefer extracting selected records when the incident affects a small subset. Keep current production on its existing connection; handle reviewed surgical correction separately.
5. Only for a deliberately approved full cutover: establish a write freeze/maintenance plan, capture current DB evidence and reconcile any wanted later writes. Review app version, roles, secrets, CA, pool settings, documents' object references, and all dependent jobs/integrations. Update the web application's runtime DB connection **only after that decision**, and change every DB-consuming operational component intentionally, including the backup source. Keep HTTP-only trigger jobs on their correct app origin. The generic v1 loopback restore script is not a managed-cluster cutover tool.
6. Validate System Health deployed SHA, migration currency/checksums/client compatibility, DB connectivity, authenticated reads and controlled writes after approval, and disabled/enabled integration state. Monitor errors and resume jobs deliberately. Keep the original cluster isolated for an approved investigation/retention period; do not automatically delete it. Record an abort plan and ownership before switching connections: writes on the new timeline make switching back a reconciliation problem.

## Object-storage protection and encryption

**PostgreSQL archives do not contain Spaces files.** Restored Document/attachment/email-file/logo rows can point to missing or newer objects. Recover object versions/copies as of a compatible point and verify samples independently. A successful DB drill does not establish attachment recovery.

[Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/) and [backup guidance](https://docs.digitalocean.com/support/how-do-i-back-up-spaces-buckets/) state there are no built-in Spaces backups. [Versioning](https://docs.digitalocean.com/products/spaces/how-to/enable-versioning/) is available via the S3 API; it can help with overwrites/delete markers but is not protection against account loss or permanent version deletion. Current versioning on the document bucket is **unverified**. Lifecycle expiration is a retention/cost mechanism, not a backup. Evaluate versioning and version retention for documents before enabling anything.

The current [S3 compatibility matrix](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/) does not establish automatic cross-region replication, and cross-region/cluster CopyObject is unsupported. Do not assume AWS replication configuration works on Spaces. [DO transfer guidance](https://docs.digitalocean.com/products/spaces/how-to/transfer-between-regions/) uses a tool such as rclone to download/upload to another region. A separately scheduled copy/backup with protected deletion semantics is an appropriate later document-recovery project; simple mirroring that propagates deletions is insufficient. Documents' recovery protection is weaker/unverified compared with managed DB PITR and must remain a separate open risk.

[DigitalOcean's shared responsibility statement](https://www.digitalocean.com/security/shared-responsibility-model-app-platform) documents LUKS for managed databases and AES-XTS disk encryption for Spaces. This differs from the S3 API's optional **SSE-C** customer-key object encryption; bucket-level encryption configuration is not supported in the compatibility matrix. Do not send AWS-specific SSE-S3/KMS configuration and claim it was applied. Backups use verified DB TLS/CA and HTTPS Spaces requests; private ACLs plus bucket-scoped credentials restrict reads. Temporary files are private and short-lived, not themselves client-encrypted; use an appropriately trusted operational host with protected disks/memory.

For the current v1 risk model, provider encryption plus private scoped access is sufficient; no custom client-side encryption is added. This does not protect against an authorized compromised account/key or a provider breach with logical access. If the threat model requires protection from those, stop for a separate key-management design: independent key custody, rotation/version metadata, recovery escrow, loss testing and offline decryption drills must precede implementation. Losing that key can permanently invalidate every backup. No client-encryption layer is recommended or implemented by this build.

Later, replicate validated logical backups to an **independent account/provider** such as AWS S3 or Backblaze B2, using separate scoped credentials, retention and read-back verification. This protects against DO account/provider-level loss; another bucket in the same account does not. Also preserve a Git mirror and app configuration/key recovery inventory independently. V1 deliberately keeps the implemented destination on the dedicated DO Spaces bucket, and implements no cross-provider replication.

## Recovery objectives (initial planning targets, not SLAs)

| Layer / incident | Proposed RPO | Proposed RTO planning target |
| --- | --- | --- |
| Bad app deployment with compatible schema | No DB point-in-time rollback intended | 30–60 minutes for diagnosis, reviewed revert/CI/deploy/verification; measure actual pipeline time |
| Managed PostgreSQL PITR within available window | Target latest recoverable pre-incident transaction; lower loss than daily dumps, actual WAL availability must be inspected | Initial 4-hour staffed recovery target; includes restore, validation, reconciliation and cutover; not a provider guarantee |
| Daily logical recovery | Up to 24 hours plus scheduling/dump-start lag when every daily run succeeds; increases with missed runs | Initial 4-hour staffed target for current small-CRM assumption; revise from measured real-backup drills |
| Documents / provider-account loss | No evidenced bounded RPO until versioning/separate copies and independent recovery are configured | Unmeasured; cannot claim the DB target for missing files or lost secrets/account access |

The logical archive reflects pg_dump's consistent database snapshot near dump start, not upload completion time. Its run timestamp is job start context, not an exact committed-transaction boundary. Longer logical retention provides recovery points after the provider's seven-day window. RPO/RTO clocks include detection, approval, staffing, secret recovery, object availability and network transfer; a fast synthetic fixture restore does not validate these production targets. Review objectives with Chad after the first measured drill and capacity inventory.

## Incident decision tree

```text
Bad app deploy
  → assess schema compatibility → reviewed Git revert/fix → CI → main → DO → System Health
Bad migration
  → assess backward compatibility
    → compatible: revert app, retain applied migration history
    → incompatible/destructive: contain writes → forward fix or separate DB recovery
Small accidental data loss / bad import
  → known reliable values: reviewed app correction
  → otherwise: separate logical/PITR restore → validate → extract affected rows → approved surgical correction
Major DB corruption/loss
  → available PITR? restore new cluster : restore logical archive into new isolated DB
  → validate schema/data/app/object references → reconcile later writes → approved controlled cutover
Missing attachment/files
  → inspect object versions/separate object backup → recover files independently of DB
DO account/provider loss
  → independent-provider copies + independent config/key custody (deferred; v1 does not bound recovery)
```

## Chad's post-review configuration checklist (nothing applied)

1. Review/merge/deploy only through the existing release process after separate authorization. No migration is needed for this feature. Preserve Node 22.23.4, Prisma 6.19.3, Hosted CI requirements and branch protection. No CI workflow changes are required: focused mock tests run under the existing `npm test`; Docker drill is an explicit operational check.
2. Inventory exact production app/repository/main/deployed SHA; managed cluster/database/region/server major, current data size, connection budget and trusted sources; verify the provider Backups page has recent daily backups and record actual earliest/latest recovery time. Confirm this is Managed PostgreSQL, not an App Platform dev DB. Record last real restore evidence or its absence.
3. Confirm actual document bucket, versioning state, lifecycle, access keys and whether any independent file backup exists. Record missing protection as an open risk; approve a separate document-protection project as needed.
4. Approve/create the dedicated private **Standard** backup bucket in the selected region, with no CDN/public policy. This implementation did not create it. Create only bucket-limited backup credentials at the provider's minimal available write level and a separate Read credential for restore. Review the coarse delete-right limitation; never reuse app keys or grant the app backup access. Audit the existing app key too: a pre-existing account-wide key could gain backup access when the bucket is added. Restrict/rotate it to document-only access under separate approval if necessary.
5. Have a DB administrator provision/review the selected-database read-only backup role, existing grants and default privileges, and copy the correct managed CA into approved runtime configuration. Confirm the source is a direct DB connection with verify-full TLS and correct hostname, not a pool endpoint or another database. No source privileges are changed here.
6. Build/select the separate operations Dockerfile job from the reviewed revision, verify source major compatibility with pg_dump 17, and configure only its runtime variables/secrets from the table. Set source Git SHA binding. Never put passwords/URLs into run commands/build args. Allow the job through existing DB trusted-source controls only with approval. Check actual available temporary space against the chosen cap.
7. Add the SCHEDULED job at `0 2 * * *`, `Etc/UTC`, `/app`, command `node scripts/operations/backup-postgres.mjs`, 30-minute job allowance, after checking other heavy jobs. No schedule or App Platform environment has been modified by this build.
8. Perform an initial supervised **read-only source backup** after approval. Verify private object existence/metadata, successful full read-back, two lifecycle lines, zero exit status and no leftover temp dump. Confirm an unauthenticated request to the unsigned object URL is denied (403/404, never a downloadable 200) and public bucket listing is denied; do not generate/log a signed URL for this test. Private object ACLs do not override an external public-read bucket policy, so effective provider access must be checked. Record key, checksum, size, runtime and Git version securely. Test that the job cannot access the document bucket and the normal app cannot access backups. A first run exceeding limits requires capacity review before enabling scheduling.
9. Run the isolated real-backup drill with only Read Spaces credentials and disposable-target credentials, record migration/client/count checks and elapsed recovery time. Confirm attachment-recovery limitations. Assign quarterly drills and pre-incompatible-migration rehearsals to a named owner.
10. Review/apply the three prefix lifecycle rules **only under separate approval**, preserving any existing rules; approve costs and record retention. Assign failure/missing-backup monitoring and evidence retention. Confirm next daily completion and Sunday/month-first tier behavior after activation; until these checks pass, do not claim scheduled production backup coverage.
11. Keep source DB credentials out of restore environments; preserve app secret/encryption-key recovery inventory outside DB/provider-only custody. Review independent-provider copies and object-version/copy protection as deferred work. Update measured RPO/RTO after the real drill.

## Initial implementation validation evidence

Executed 2026-10-28 on `ops/backup-restore-readiness-v1`, using Node 22.23.4. These are implementation/synthetic evidence, not live provider backup or production recovery evidence.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed; Prisma generation 6.19.3 |
| `npm test` (complete unit/regression suite) | 1,636 passed, zero failed, one existing opt-in test skipped (1,637 total) |
| `node --test tests/backup-restore.test.mjs` | 13 passed: config/URL validation, safe naming/tiering, source command safety, archive/upload/checksum failures, cleanup/size limits, guards/empty/clean restores, safe logs, private Spaces requests, CLI exit status and runtime pins |
| `npm run build:release` | Production Webpack build passed |
| `docker build --target production -t saleshub-recovery-v1-production:local ./app` | Passed; isolated image inspection confirmed Node 22.23.4 and Prisma CLI/client/generated runtime 6.19.3 |
| `docker build -f app/Dockerfile.operations -t saleshub-recovery-ops:local ./app` | Passed; separate minimal locked operations runtime |
| `node app/scripts/operations/restore-drill.mjs` | Passed: full migration chain, real custom dump, verified TLS, SELECT-only backup role, three retention tiers through mock object storage, download/hash/list, fresh restore, nonempty refusal, confirmed clean restore, Prisma status/relationships/sequences and cleanup |
| Browser smoke | Not required: no application/UI code was changed. Synthetic restored-DB Prisma connectivity passed; real-backup authenticated application drill remains an operator acceptance step |
| `git diff --check` | Passed |

The successful synthetic archive was **553,741 bytes**; SHA-256 `15249751df803e8988aad03b1d484fbd4457518f5decf6bede7002ea7d1a2f53`. All six representative fixture tables contained one record after restore; latest migration was `20261024210000_demo_operational_owner`, unfinished migrations zero, and Prisma reported up to date. Empty restore took about 1.7 seconds and clean restore about 2.5 seconds **for this tiny fixture only**. The drill container/temporary DBs and local dump files were removed. These timings do not validate production RTO. No live Spaces transfer was performed.

Local Docker storage was nearly full before validation. Approved removal of regenerable build cache allowed the builds to proceed; no existing images, application containers, volumes or database data were deleted. The feature's bounded temporary storage/free-space guard remains important independently of that host maintenance.

Changed files: this runbook; deployment/migration-operations cross-links; root `.env.example`; `app/Dockerfile.operations`; `app/scripts/operations/{recovery-common,backup-spaces,backup-postgres,restore-postgres,validate-restored-postgres,restore-drill,restore-drill-fixture}.mjs`; the operations runtime manifest/lock under `app/scripts/operations/recovery-runtime/`; and `app/tests/backup-restore.test.mjs`. No schema/migration, app feature, existing web Dockerfile, main app dependency lock, Hosted CI policy or branch protection changes. No commit, push, merge, deploy, DO change or production-data operation was performed.

## Final pre-commit safety review

Reviewed on 2026-10-28, initially without changing code. Read-only probes used synthetic URLs/credentials, missing synthetic files and mock storage/Docker clients; no production access or DigitalOcean API changes were involved. The following defects were reproduced and fixed:

| Finding | Correction / evidence |
| --- | --- |
| Protected connections compared host strings literally; localhost, integer/octal IPv4 and IPv6 equivalents could bypass comparison | Canonical host/port/database identities, conservative loopback equivalence, rejection of local production identities, numeric pinning for localhost restore targets, raw-whitespace/query-override rejection; adversarial URL matrix passes |
| Node child-process debug mode exposed a placeholder DB password before structured redaction | Reject NODE_DEBUG/NODE_DEBUG_NATIVE before credential-bearing child/HTTP calls; synthetic debug-output regression passes |
| Early upload read-stream failure became an uncaught Node error, bypassing normal cleanup | Attach the error handler immediately, abort the in-flight upload, mask SDK payloads, reject safely and clean dump/CA files; missing-file/aborted-client regression passes |
| A failed spawn kept Node's 25-minute native timeout alive despite reporting failure | Own an unreferenced command timer and clear it on both error and close; missing-tool CLI exits nonzero within the three-second test allowance |
| Host drill inherited remote Docker context/host and host credentials into its Docker client | Pin local Unix socket, provide only PATH to Docker, keep container network none and explicit fixture-only environment; fake-Docker isolation/cleanup regression passes |
| Free-form environment labels/vendor output or unsanitized child diagnostics could echo unintended text | Fixed environment catalog and shared key validation, numeric pg_dump version metadata, sanitized child exceptions/JSON/locations, primitive-only logger fields without object coercion/toJSON hooks |

The source-role drill now also rejects CREATE/ALTER and INSERT/UPDATE/DELETE with the helper's read-only session override omitted for those privilege probes in the fresh cluster. This proves the fixture role itself lacks those permissions. The real pg_dump then uses that same role with its additional read-only session setting. Relationship, sequence and full Prisma migration status checks remain in the drill; expected refusal events are retained in the captured fixture log.

Retained limitations: a URL guard cannot detect a deliberate production tunnel on a permitted local listener or prove the truth of operator-supplied production inventory. Use an isolated instance/runner, not a local production proxy. Effective bucket privacy, live managed server major, actual schedules, least-privilege grants, first production-backup acceptance and a real-backup restore drill still require the explicit post-review operator checklist. 02:00 UTC avoids known weekly snapshots, can overlap quarter-hour Calendar polling, and is 21:00 EST / 22:00 EDT on the prior Eastern date. The four-hour recovery goal remains unmeasured for production and is not an SLA.

Post-fix validation:

| Check | Result |
| --- | --- |
| Focused recovery safety suite | **25 passed**, including adversarial URL forms, debug-mode privacy, primitive logger fields, safe exceptions, missing-tool exit timing, SIGTERM cleanup, partial uploads, early stream errors and fake-Docker isolation |
| Complete unit/regression suite | **1,648 passed**, zero failed, one existing opt-in SQL fixture test skipped (1,649 total); latest logger checks also passed in the final focused rerun |
| Lint and typecheck | Passed after fixes |
| Operations image build | Passed; inspected final image: **Node 22.23.4**, **Prisma 6.19.3**, **pg_dump 17.11**. Managed server-major compatibility remains a live pre-activation check |
| Disposable PostgreSQL drill | Passed with full migrations, verified TLS, source write denials, download/checksum/archive parsing, empty and clean restores, counts, relationships, sequences and Prisma status |
| Lifecycle evidence | Four started runs each have exactly one terminal event; the intentional nonempty-target refusal emits restore.failed and never restore.completed |
| Cleanup | Dump/CA temp cleanup passed; no drill containers remain |
| Schedule conversion | Verified January/July and both 2026 DST transition boundaries with America/New_York formatting; fixed UTC schedule has no local DST duplicate/skip |
| Diff/scope | git diff --check passed; no schema/migrations, Hosted CI, main app dependency/runtime, web Dockerfile or application feature changes |

Final synthetic drill archive: **553,756 bytes**, SHA-256 `106cc6b8036fa45662cdac7d2129ccbe0a73ae67001de714b04e2f5cc90e0667`. Six representative tables each contained one fixture record, latest migration `20261024210000_demo_operational_owner`, unfinished migrations zero, Prisma status up to date. This remains synthetic evidence with mock Spaces, not a measured production restore or live logical-backup coverage.

The candidate is appropriate for code review/commit after these fixes. Production enablement remains contingent on the explicit configuration and acceptance checklist. This review performed no commit, push, merge, deployment, DigitalOcean provisioning, production restore or production-data mutation.
