# Local development user testing

This tool lets a Google authenticated SalesHub Admin test the permissions and record scope of an existing active local CRM user. It is for localhost development UAT only and must never be used as a production support feature.

Set `ENABLE_DEV_IMPERSONATION=true` in the repository's local `.env` file used by Docker Compose. The example file defaults to `false`. Compose passes the value to the app container. After changing it, recreate the app container with `docker compose up -d --no-deps --force-recreate app`; a source rebuild is unnecessary for this environment change. `NODE_ENV=production` always disables the feature, even when the flag is `true`.

Sign in normally with Google as an active CRM Admin. Choose **Test as user** in the header and select an active CRM user. The banner shows the effective user and offers **Return to Admin**, including when testing a non Admin role. Signing out clears the test state.

The Auth.js session continues to identify the real Google linked Admin. An HTTP only, same site, eight hour cookie holds only the selected CRM user ID. Every request reloads that user from the database and accepts it only while the real authenticated user is Admin, both development gates are open, and the selected user remains active and unarchived. Invalid or stale cookies are ignored and cleared by the request guard. Inactive or archived users cannot be selected.

Normal application permissions, ownership queries, and business write attribution use the selected effective user. Writes during testing therefore modify local data as that user would. Impersonation management uses the real Admin identity. This feature adds no database state or schema changes, and does not change Google OAuth.
