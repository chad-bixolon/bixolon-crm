# Google Workspace sign-in

Set `AUTH_SECRET` to a long random secret. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` to the OAuth web application's credentials. Set `GOOGLE_WORKSPACE_DOMAIN` to the actual BIXOLON Workspace hosted domain; this checks Google's signed `hd` claim. `AUTH_URL` must be the exact browser origin used for each environment. None of these values belongs in Git.

## Local development through SSH

Set these values in the ignored root `.env` file used by Compose (or in equivalent runtime secrets). The committed `.env.example` contains names only:

When rebuilding after a dependency change, run `docker compose up -d --build --renew-anon-volumes app` so the app's anonymous `/app/node_modules` volume contains the packages from the new image.

| Variable | Local value |
| --- | --- |
| `AUTH_URL` | `http://localhost:3000` |
| `AUTH_SECRET` | A private value generated with `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Web OAuth client ID from Google Cloud |
| `AUTH_GOOGLE_SECRET` | Secret for that OAuth client |
| `GOOGLE_WORKSPACE_DOMAIN` | The actual BIXOLON Google Workspace hosted domain; do not use the CRM server hostname |

From the browser computer, forward local port 3000 to the CRM host, for example `ssh -L 3000:127.0.0.1:3000 <ssh-user>@192.168.60.18`. Open **`http://localhost:3000` in that same computer's browser**. Register **`http://localhost:3000/api/auth/callback/google`** as the exact authorized redirect URI for the Google web OAuth client. `AUTH_URL`, the browser origin, and the redirect URI must agree. The application listens on the remote host; `localhost` in the OAuth redirect belongs to the browser computer and reaches the app through the tunnel.

Google Cloud setup is manual: create a Web application OAuth client, configure its consent screen for the BIXOLON Workspace audience, register the localhost callback, and supply the client ID and secret. The app requests `openid email profile` only. Set `GOOGLE_WORKSPACE_DOMAIN` to the domain present in Google's signed `hd` claim. Restart the app after changing environment variables. Do not register the LAN IP as a Google redirect URI.

## Create and verify a test user

An existing ADMIN can open **Administration → Users → New user**, enter the test user's exact verified Google Workspace email, select a CRM role, and leave the user Active. The edit page can change the role or active status. The list and edit pages show **Google sign-in: Not linked** until the first successful Google sign-in, then **Linked**. No local password or Google token is stored.

For a new database with no ADMIN user, a database operator must bootstrap one approved ADMIN with their own exact Workspace email. Connect with `docker compose exec db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` and run this statement after replacing the placeholders:

```sql
INSERT INTO "User" (email, "firstName", "lastName", role, active, "updatedAt")
VALUES ('<verified-workspace-email>', '<first-name>', '<last-name>', 'ADMIN', true, now());
```

Then sign in through the localhost tunnel with that Google account. The first login links its verified email to the pre-created CRM user and preserves the assigned role. Verify **Linked** in Administration → Users. A different email, inactive user, or wrong Workspace domain is denied without creating a CRM user.

An ADMIN can reset a linked Google identity from the user edit page for account recovery. The action requires the exact CRM email and a confirmation prompt. Existing sessions for the removed identity stop working on their next request; a later approved Google sign-in may link again. If a Google account should no longer regain access, deactivate its CRM user before resetting the link.

Use only the `openid email profile` scopes. Google establishes identity. An ADMIN pre-creates each CRM `User` with an email, role, and active status. On first sign-in, the app requires a verified Google email and the configured Workspace `hd` claim. It first searches `ExternalIdentity` by issuer `https://accounts.google.com` and Google subject. If absent, it finds an existing active CRM user by exact verified email and creates the `ExternalIdentity` link. It never creates a CRM user or changes their preassigned role. An unknown or inactive user is denied. After linking, issuer and subject are authoritative, even if the Google email later changes. Unique database constraints prevent a Google subject or CRM user from being silently relinked.

Expected callbacks by browser URL are below. Register only URIs that satisfy Google's OAuth validation rules:

| Environment | URI |
| --- | --- |
| Local browser | `http://localhost:3000/api/auth/callback/google` |
| Current development browser URL `http://192.168.60.18:3000` (Google registration unsupported) | `http://192.168.60.18:3000/api/auth/callback/google` |
| Staging | `https://<staging-host>/api/auth/callback/google` |
| Production | `https://<production-host>/api/auth/callback/google` |

The exact callback for the current browser URL is `http://192.168.60.18:3000/api/auth/callback/google`, and its matching `AUTH_URL` would be `http://192.168.60.18:3000`. **[Google's OAuth web-client rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation) reject raw non-loopback IP hosts and require HTTPS outside localhost**, so this current LAN URL cannot be registered as an authorized redirect URI. For Google sign-in, access the app through `http://localhost:3000` (for example using a local port forward), or choose an authorized development hostname served over HTTPS. Set `AUTH_URL` and the Google redirect URI to that actual browser origin. Staging and production hosts remain unspecified; replace their placeholders with the real HTTPS hostnames.

The following two migrations were applied after review on September 16, 2026. `prisma migrate status` reported the database schema up to date afterward.

`20260916030000_task_create_idempotency` adds an optional UUID key to tasks and a unique index so repeated task-create submissions can reuse their first result:

```sql
ALTER TABLE "Task" ADD COLUMN "createKey" UUID;
CREATE UNIQUE INDEX "Task_createKey_key" ON "Task"("createKey");
```

`20260916040000_marketing_manager` adds the role to the existing PostgreSQL enum:

```sql
-- Forward-only addition. Review before applying to any database.
ALTER TYPE "UserRole" ADD VALUE 'MARKETING_MANAGER';
```

## CRM permissions

| Role | Accounts and contacts | Opportunities and pipeline | Tasks and notes | Products | User admin | Integrations | Pricing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ADMIN | Read/write | Read/write, company | Read/write, company | Read/write | Manage | Manage | Read |
| SALES_MANAGER | Read/write | Read/write, company | Read/write, company | Read | No | No | Read |
| SALES | Read/write | Read/write, own lists/dashboard | Read/write, assigned lists/dashboard | Read | No | No | Read |
| MARKETING_MANAGER | Read/write | No | Read/write | Read | No | No | No |
| READ_ONLY | Read | Read | Read | Read | No | No | No explicit pricing permission |

Checks run in the request proxy and again in each mutating server action. The current user's active status and role are read from the CRM `User` record when a session is loaded. Future integrations and customer-specific pricing can use dedicated permission names in `lib/authorization.ts`.
