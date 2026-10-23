# Support Gmail: Google Cloud and DigitalOcean rollout

This is a review/runbook artifact. No deployment, production migration, mailbox connection or production test action is authorized by preparing it. Perform rollout only after reviewing the port and authorizing the release. Review the existing dependency advisories recorded in [validation](support-email-validation.md) and decide remediation before deployment.

## Runtime configuration

Use App Platform **runtime** variables; encrypt secrets, never pass them as build arguments. [DigitalOcean environment settings](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/) document scope and encryption.

| Variable | Type | Required production value |
| --- | --- | --- |
| `SUPPORT_GMAIL_ENABLED` | Normal | `true` when ready to enable; `false` is the immediate feature off switch |
| `SUPPORT_GMAIL_CLIENT_ID` | Normal | Dedicated Support Web OAuth client; must differ from `AUTH_GOOGLE_ID` |
| `SUPPORT_GMAIL_CLIENT_SECRET` | Encrypted secret | Dedicated Support OAuth client secret |
| `SUPPORT_GMAIL_ENCRYPTION_KEY` | Encrypted secret | Canonical base64 of 32 random bytes; generate securely with `openssl rand -base64 32` and retain securely for recovery |
| `SUPPORT_GMAIL_MAILBOX` | Normal | `support@bixolonusa.com` |
| `SUPPORT_GMAIL_OAUTH_CALLBACK_URL` | Normal | `https://<production-saleshub-domain>/api/support-gmail/callback`; optional only when derived from canonical `AUTH_URL` |
| `SUPPORT_GMAIL_EXPECTED_DATABASE_IDENTITY` | Normal | Exact `<encoded-db-user>@<db-host>:<db-port>/<database-name>` from the production PostgreSQL URL, without password/query; default PostgreSQL port is 5432 when omitted |
| `SUPPORT_GMAIL_INITIAL_LOOKBACK_DAYS` | Normal | `30` (also code default); cap stays 50 messages |
| `AUTH_URL` | Existing normal | Exact canonical production HTTPS origin, without path/query/credentials |
| `DATABASE_URL` | Existing encrypted secret | Production external PostgreSQL URL; `sslmode=require`, `verify-ca` or `verify-full`; preserve existing pool/TLS settings |
| `AUTH_SECRET` | Existing encrypted secret | Existing SalesHub session/state secret |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GOOGLE_WORKSPACE_DOMAIN` | Login settings | The domain is the sign-in bootstrap while no trusted-domain rows exist; no Support scope is added |
| `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT`, `SPACES_PREFIX` | Existing normal | Existing private production Support object store; prefix `prod` |
| `SPACES_ACCESS_KEY_ID`, `SPACES_SECRET_ACCESS_KEY` | Existing encrypted secrets | Existing private Spaces credentials |
| `NODE_ENV` | Image setting | `production` from the production Docker target |

Leave `SUPPORT_GMAIL_MOCK`, `SUPPORT_GMAIL_TEST_FIXTURE`, `E2E_AUTH_ENABLED`, `E2E_STORAGE_ENABLED`, `ENABLE_DEV_IMPERSONATION` unset/false in production. No `SUPPORT_GMAIL_POC_*`, credential path, local login or dry-run configuration is used. Do not reuse the POC database, token file or its encryption-key context. This release adds no dependencies.

## Google Cloud setup

1. Open the Google Cloud project for the **dedicated Support OAuth client**. Enable **Gmail API**. Keep SalesHub login/Calendar clients separate.
2. In Google Auth Platform / Clients (or APIs & Services / Credentials), select/create a **Web application** client dedicated to Support. Add the exact authorized redirect URI `https://<production-saleshub-domain>/api/support-gmail/callback`, replacing the placeholder with the hostname in `AUTH_URL`. Keep the validated POC client's localhost redirect while it remains in use; do not modify its runtime.
3. Configure Data Access / consent with only `https://www.googleapis.com/auth/gmail.readonly`. No send, draft, modify, label or full-mail scope. Review the actual project's Internal/External audience, Workspace administrator restrictions and Google's verification requirements before production rollout. External Testing is unsuitable for a durable production connection: its refresh tokens for this scope expire after seven days. See [Google token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration) and [web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).
4. Allow the expected mailbox `support@bixolonusa.com` under the chosen audience. Supply this client's ID/secret to App Platform. SalesHub suggests that mailbox during consent and verifies the Gmail profile server-side. If this dedicated client previously granted broader permissions, remove that grant in the mailbox's Google account and re-consent with only read-only access.

## Release sequence

1. **Back up production.** Confirm actual production DB identity first. Take/verify a managed PostgreSQL backup and a PostgreSQL 17 logical custom-format archive using the approved credentials. Retain the existing app image/release identifier and a secure copy of runtime secrets. From an authorized PostgreSQL operator environment (these commands are instructions, not executed during preparation):

   ```sh
   umask 077
   backup_path="saleshub-before-support-email-$(date -u +%Y%m%dT%H%M%SZ).dump"
   pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup_path"
   pg_restore --list "$backup_path"
   pg_restore --file=/dev/null "$backup_path"
   sha256sum "$backup_path"
   ```

   Require exit 0 and verify restore in an isolated database according to the existing backup process. Protect the archive; email/token metadata is confidential.
2. **Set runtime values/secrets** above on the web service. Initially use `SUPPORT_GMAIL_ENABLED=false`. Verify database identity/TLS, canonical URL and private Spaces configuration. A password rotation/pool adjustment does not change token binding; a host/database/client/mailbox/key change requires reconnecting.
3. **Register the Google production callback** exactly as above before connecting. From the correctly configured runtime/operator environment, print the non-secret URI to paste into Google Cloud:

   ```sh
   node -e 'const u = new URL(process.env.AUTH_URL); console.log(new URL("/api/support-gmail/callback", u).toString())'
   ```

   Require canonical HTTPS AUTH_URL and an exact match to any configured `SUPPORT_GMAIL_OAUTH_CALLBACK_URL`. No production domain is hard-coded in the source.
4. **Prepare the reviewed release** using the existing Dockerfile final production target, source directory `app`, HTTP port 3000 and `/api/health` health check. Keep automatic promotion under control. [Existing deployment instructions](deployment.md) apply.
5. **Apply migrations before promoting new traffic.** Review the additive `20261013230000_support_email_production` SQL and all other pending main migrations. Configure one App Platform **pre-deploy job** for the release image with run command `npm run db:deploy`, encrypted production `DATABASE_URL`, and database network access. Require successful exit before promotion; do not migrate on every web startup. See [DigitalOcean deployment jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/). Equivalent established one-off image commands, from a securely configured operator environment:

   ```sh
   docker run --rm --env DATABASE_URL <reviewed-release-image> npm run db:status
   docker run --rm --env DATABASE_URL <reviewed-release-image> npm run db:deploy
   docker run --rm --env DATABASE_URL <reviewed-release-image> npm run db:status
   ```

   Expect no pending migrations after deploy. Never use `db push`, `migrate dev`, `migrate reset`, or edit applied migration SQL in production. The main database must not have POC migration history. If it does, stop and reconcile its schema/history before rollout.
6. **Promote and verify health.** `curl --fail --silent --show-error "$AUTH_URL/api/health"` must return 200. This verifies web serving only; also verify migration status, normal sign-in, CRM pages, database-backed Support Cases and Spaces access. Then enable `SUPPORT_GMAIL_ENABLED=true` and load the new runtime configuration.
7. **Connect Support Gmail** from the canonical HTTPS URL as an actual Support/Admin user. Open Support Cases → Support Inbox → Manage → Connect Support Gmail. Authenticate the expected mailbox; verify consent offers read-only access.
8. **Verify connection identity/scope.** Status must show `Gmail connected · support@bixolonusa.com · Last synced …`. Manage shows Gmail read-only, 30 days, cap 50. Inspect only non-secret metadata if needed:

   ```sql
   SELECT "id", "mailbox", "grantedScope", "connectedAt", "connectedByUserId", "lastSyncedAt"
   FROM "SupportGmailConnection";
   ```

   Require one `support` record, exact mailbox and exact read-only scope. Never select/export encrypted tokens into routine logs.
9. **Verify Inbox** uses recent messages and conservative match suggestions. Check direct/Group duplicates remain separate. A dormant older thread must be absent; a recent reply on it may appear subject to the cap. Confirm ordinary Sales/Read Only users cannot access inbox actions.
10. **Create one controlled test Case** from an agreed Support email. Confirm original source summary, larger description, matched relationships, one Case/email link, timeline and repeat-submission duplicate prevention. Manually link another approved message if needed; verify Ignore/Restore are CRM decisions only. These are explicit authorized production CRM writes during rollout, not part of preparation.
11. **Select and import one safe attachment** into that Case. Verify private storage, download and Gmail provenance; repeat import must not add a duplicate. Confirm unselected files stay absent and optional import failure leaves Case/email link saved. Test note growth on desktop/tablet/mobile.
12. **Confirm Gmail was unchanged.** Record the chosen messages' Gmail IDs, thread IDs, labels/read state and attachment availability before the test and compare after the Inbox, Case, Link, Ignore/Restore and import reads. No sent mail, drafts, label, archive, delete or read/unread changes should occur. Complete the controlled Case under normal Support practice.

## Rollback and recovery

Disable `SUPPORT_GMAIL_ENABLED` first to stop reads and intake. Revert to the previous reviewed application release if required. This migration is additive; keep its tables, columns, unique indexes and applied history during an app rollback. Saved Case/email/attachment records remain and normal manual Support work continues. Do not drop tables or reverse SQL on a live database.

Disconnect removes only the stored credential; it does not remove CRM history, attachments or the Google grant. To revoke, use the mailbox Google account's connection settings for this dedicated client. To recover key loss, changed identity or revoked/expired access, configure the intended environment and reconnect. A failed reconnect leaves the previous credential untouched. For database restore, use the approved incident procedure, coordinate writes and restore secrets/Spaces consistency; restoring an old archive can discard later CRM work and is not a routine feature rollback. Investigate P3018 before retrying; use Prisma's documented migration-recovery procedure only after reviewing the failure, never mark failed SQL applied blindly.
