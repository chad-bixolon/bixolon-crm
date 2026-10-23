# Google Workspace sign-in

Personal Google Calendar consent and credentials use a separate flow. See [Google Calendar connection](google-calendar-connection.md). Normal sign-in continues to request `openid email profile` only.

Set `AUTH_SECRET` to a long random secret. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` to the OAuth web application's credentials. Set `GOOGLE_WORKSPACE_DOMAIN` to the initial trusted Google hosted domain. It is the bootstrap fallback only while no `TrustedSignInDomain` rows exist. `AUTH_URL` must be the exact browser origin used for each environment. None of these values belongs in Git.

## Local development through SSH

Set these values in the ignored root `.env` file used by Compose (or in equivalent runtime secrets). The committed `.env.example` contains names only:

When rebuilding after a dependency change, run `docker compose up -d --build --renew-anon-volumes app` so the app's anonymous `/app/node_modules` volume contains the packages from the new image.

| Variable | Local value |
| --- | --- |
| `AUTH_URL` | `http://localhost:3000` |
| `AUTH_SECRET` | A private value generated with `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Web OAuth client ID from Google Cloud |
| `AUTH_GOOGLE_SECRET` | Secret for that OAuth client |
| `GOOGLE_WORKSPACE_DOMAIN` | Initial approved corporate Google hosted domain; do not use the CRM server hostname |

From the browser computer, forward local port 3000 to the CRM host, for example `ssh -L 3000:127.0.0.1:3000 <ssh-user>@192.168.60.18`. Open **`http://localhost:3000` in that same computer's browser**. Register **`http://localhost:3000/api/auth/callback/google`** as the exact authorized redirect URI for the Google web OAuth client. `AUTH_URL`, the browser origin, and the redirect URI must agree. The application listens on the remote host; `localhost` in the OAuth redirect belongs to the browser computer and reaches the app through the tunnel.

Google Cloud setup is manual: create a Web application OAuth client, configure its consent screen for the intended corporate audience, register the localhost callback, and supply the client ID and secret. Normal sign-in requests `openid email profile` only. Set `GOOGLE_WORKSPACE_DOMAIN` to the initial domain present in Google's signed `hd` claim. Restart the app after changing environment variables. Do not register the LAN IP as a Google redirect URI.

## Create and verify a test user

An existing ADMIN can open **Administration → Users → New user**, enter the test user's exact verified Google Workspace email, select a CRM role, and leave the user Active. The edit page can change the role or active status. The list and edit pages show **Google sign-in: Not linked** until the first successful Google sign-in, then **Linked**. No local password or Google token is stored for normal sign-in; personal Calendar connections store a separate encrypted refresh token.

For a new database with no ADMIN user, a database operator must bootstrap one approved ADMIN with their own exact Workspace email. Connect with `docker compose exec db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` and run this statement after replacing the placeholders:

```sql
INSERT INTO "User" (email, "firstName", "lastName", role, active, "updatedAt")
VALUES ('<verified-workspace-email>', '<first-name>', '<last-name>', 'ADMIN', true, now());
```

Then sign in through the localhost tunnel with that Google account. The first login links its verified email to the pre-created CRM user and preserves the assigned role. Verify **Linked** in Administration → Users. A different email, inactive user, or wrong Workspace domain is denied without creating a CRM user.

An ADMIN can reset a linked Google identity from the user edit page for account recovery. The action requires the exact CRM email and a confirmation prompt. Existing sessions for the removed identity stop working on their next request; a later approved Google sign-in may link again. If a Google account should no longer regain access, deactivate its CRM user before resetting the link.

Normal sign-in uses only the `openid email profile` scopes. Google establishes identity. An ADMIN pre-creates each CRM `User` with an email, role, and active status. On first sign-in, the app requires a verified Google email and the configured Workspace `hd` claim. It first searches `ExternalIdentity` by issuer `https://accounts.google.com` and Google subject. If absent, it finds an existing active CRM user by exact verified email and creates the `ExternalIdentity` link. It never creates a CRM user or changes their preassigned role. An unknown or inactive user is denied. After linking, issuer and subject are authoritative, even if the Google email later changes. Unique database constraints prevent a Google subject or CRM user from being silently relinked.

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

See [Authorization Correctness & Policy Foundation v1](authorization-policy.md) for the current capability matrix, record policies, explicit owner/assignee populations, Read Only certification, and maintainer rules. `lib/authorization.ts` is the executable predefined capability matrix.

The request proxy and server-side action/service checks provide separate protection. The v1 audit found that `submitUser` previously lacked its own check; both that action and `saveUser` now independently require an active, unarchived Admin. Do not assume a protected page authorizes a mutation, or that every legacy persistence helper performs its own check. User saves also prevent removal of the final usable Admin within the transaction. There is currently no application User archive/delete path.

Marketing Manager has read context for Accounts, Contacts, Opportunities, and Projects, plus pricing read access; it does not have Sales writes. Read Only retains pricing read access and cannot mutate business records. Support retains catalog visibility without negotiated/customer pricing. Personal-state exceptions are documented separately from business writes in the policy foundation.

Sales users may view other Sales reps’ Accounts, Opportunities, and Projects through lists, relationship tabs, search, recent items, and direct detail URLs. Ownership determines responsibility, revenue/commission attribution, and owner-specific actions; it is not a blanket read restriction. Existing edit and reassignment permissions are unchanged.

The standalone Pipeline defaults to **My pipeline** for the effective Sales user, including during Test as user. Selecting another active, unarchived Sales or Sales Manager owner explicitly replaces that default; all totals follow the selected owner. Clear returns to My pipeline. Invalid, inactive, archived, or ineligible owner selections return no matches rather than widening the selection. Admin and Sales Manager retain their all-owner default and existing owner filters. Pipeline still includes all open forecast categories, including Omitted; it is not the same population as Quarterly Forecast.

`opportunityReadWhere` controls general Opportunity browsing. `opportunityScope` remains the ownership predicate for personal views, owner-specific actions, and financial attribution. Dashboard “My” views, forecast calculations, revenue, commission, ownership, and reassignment rules are unchanged.

## User lifecycle and future corporate access

Creating a SalesHub user approves application access; it does not create a Google account. User Administration displays only whether a Google account is linked. Recovery unlinks that identity, invalidating linked sessions without modifying the Google account. Changing a SalesHub email does not transfer the stable Google identity link. Recovery requires the target email confirmation and current authorized administrator authority, and records a non-secret history event transactionally.

Unicode first/last names, including Korean names, are supported. Names do not determine authorization. Google authentication requires verified email, an active trusted hosted and email domain, an approved active User, and stable issuer/subject linkage. Inactive and archived Users are denied.

An Administrator can manage multiple corporate domains in **Administration → Trusted Sign-In Domains**. Domains are normalized to lowercase. On the first change, the environment bootstrap domain is written as an active row in the same transaction; then persisted rows become authoritative. At least one must remain active. Existing linked sessions recheck active domains. Roles remain independent of domain. HQ staff receive roles for their work, not their address or language. The domain list controls sign-in trust only; Calendar meeting and Support email classification retain their existing separate rules.

The Google account chooser no longer sends a single-domain `hd` hint because multiple domains may be active. The server checks the signed hosted-domain claim and verified email domain against current active domains; it never provisions a User from domain membership. Pre-v1 JWT sessions lack a stored hosted-domain claim; those sessions use their signed Google email domain under the former single-domain login check until renewed. A removed domain is checked on each session resolution, with no long-lived allowlist cache.

Admin and personal preferences use the same `User.timeZone`. Validation accepts named IANA timezones supported by the pinned Node/Intl runtime, including Asia/Seoul. UTC and existing U.S. defaults remain supported. Business-date, quarterly reporting, and scheduler semantics are unchanged; they may deliberately retain the existing business timezone rather than follow personal display preferences.

## User CSV administration

CSV import creates/updates SalesHub authorization records only. It never creates Google accounts, passwords, ExternalIdentity links, or tokens. Normal approved Google sign-in and trusted-domain checks still apply. Matching uses trimmed lowercase email; a different email is a new user, not an email rename or identity transfer. Existing identity links remain untouched. Change an email through the individual User form. Archived matches cannot be restored by CSV. Export discloses only Linked/Not linked, never issuer, subject, tokens, or credentials.
