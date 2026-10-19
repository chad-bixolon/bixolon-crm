# Deployment preparation

Start each candidate review with the [maintainer release checklist](release-checklist.md) and `npm run release:check` from `app/`.

## Local development

Run `docker compose up --build` from the repository root. Compose explicitly builds the
`development` Docker target, bind mounts `app/`, and starts the local PostgreSQL service.
Set `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `DATABASE_URL` in a root `.env`
file. The local `DATABASE_URL` must point at the Compose host `db`, port 5432, with the
same database, user, and password. The app is available at `http://localhost:3000`.
The optional Adminer service remains available through the `admin` Compose profile.

## Production image

From the repository root, run `docker build -t bixolon-crm:local ./app`. The final
`production` target is the default. Its locked dependencies are installed with `npm ci`;
Prisma Client is generated during installation, Next.js is built, and the image starts
with `npm start` as the non-root `node` user. The image includes migrations and the
Prisma CLI so the same image can run the migration command separately. It does not
require a bind mount or a database connection during the build.

For a local production smoke test, supply an **external** PostgreSQL URL at runtime:

```sh
docker run --rm -p 3000:3000 -e DATABASE_URL="<external-postgresql-url>" bixolon-crm:local
```

`GET /api/health` returns HTTP 200 when the web server can serve requests. This endpoint
does not query PostgreSQL; database health and migration status need separate monitoring.

## Production environment

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required at runtime for CRM data access and migration deployment. Use an external PostgreSQL connection string with credentials and TLS settings appropriate to the provider. |
| `PORT` | Set to the App Platform service's HTTP port; defaults to `3000` in the image. |
| `SPACES_BUCKET` | Private document Space bucket name. |
| `SPACES_REGION` | Space region, such as `atl1`. |
| `SPACES_ENDPOINT` | HTTPS S3-compatible regional endpoint. |
| `SPACES_ACCESS_KEY_ID` | Encrypted runtime credential; never a build argument. |
| `SPACES_SECRET_ACCESS_KEY` | Encrypted runtime credential; never a build argument. |
| `SPACES_PREFIX` | Environment boundary: `dev` locally and `prod` in production. |

For the single App Platform container on a 22-connection DigitalOcean database,
the runtime Prisma client defaults to `connection_limit=4` when the URL has no
explicit limit. This leaves connections for migrations, administration, and
database maintenance. The app does not rewrite the `DATABASE_URL` secret, and
local Docker development keeps its existing pool behavior. If the production
secret already contains `connection_limit`, its value takes precedence; set it
to `4` if it is higher than the database can safely support. For example, add
`&connection_limit=4` to a URL that already has `?sslmode=require` (or use
`?connection_limit=4` when it has no query string). Count every additional app
container against the same 22-connection database limit.

Set `DATABASE_URL` as an encrypted runtime secret in the hosting platform. Do not pass it
as a Docker build argument or commit it to Git. Root and app `.env` files and `.env.*`
variants are Git-ignored; the Docker build context excludes them too. Local Compose
`POSTGRES_*` variables are only for development and are not production settings.

## Database migrations

Review new migration SQL and take a verified database backup before applying it to a
production database. Run migrations **once per release**, from a controlled one-off job
or equivalent release step, using the same image and its runtime `DATABASE_URL`:

```sh
docker run --rm -e DATABASE_URL="<external-postgresql-url>" bixolon-crm:local npm run db:deploy
```

This invokes `prisma migrate deploy`. Run it before directing production traffic to the
new version; check its exit status and investigate a failure before proceeding. The web
container does not migrate on startup, avoiding concurrent migration attempts when the
service scales. For the existing CRM database, follow the approval and backup procedure
in [foundation migration review](foundation-migration-review.md) and
[deployment verification](deployment-verification.md); never use `migrate dev`, `db push`,
or `migrate reset` against production.

## DigitalOcean App Platform expectations

Configure a web service from this repository with source directory `app` and Dockerfile
`app/Dockerfile` (the path from repository root). The Dockerfile's final stage is the
production image; Compose alone selects the development stage. Use HTTP port `3000`
unless setting a matching runtime `PORT`, and configure an HTTP health check at
`/api/health`. Supply `DATABASE_URL` as an encrypted runtime environment variable
pointing to a PostgreSQL database outside the app container. Do not deploy the Compose
PostgreSQL service. Leave the service run command unset so Docker's `npm start` command
is used. Arrange the one-off migration step before promoting each release; a normal
web-service startup is not the migration process. No cloud resources are created by
these repository files.

App Platform configuration references:
[Dockerfile builds](https://docs.digitalocean.com/products/app-platform/reference/dockerfile/),
[monorepo source directories](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-monorepo/), and
[health checks](https://docs.digitalocean.com/products/app-platform/how-to/manage-health-checks/).

## Support Gmail rollout

See [Support Gmail production rollout](support-email-rollout.md) for dedicated OAuth configuration, PostgreSQL encrypted token persistence, runtime boundaries, migration sequence and controlled verification. Gmail stays read-only; local development uses synthetic fixtures.

## Local Docker storage and dependency recovery

The main local CRM uses its existing PostgreSQL cluster and normal Google login. Keep server-specific database paths in ignored `compose.override.yml`; the repository Compose default remains portable. On the current local host the existing cluster is `/var/lib/docker/postgres-data`. Docker's storage root and PostgreSQL's bind source are separate settings: moving Docker storage does not move a bind-mounted database. Inspect the actual container mounts before starting or recreating PostgreSQL.

Use a long-form database bind with `bind.create_host_path: false` in the local override. This makes a missing source path fail instead of silently creating a directory in which PostgreSQL initializes an empty cluster. Never overwrite, initialize, or restore into the original cluster as part of a path repair. Back up a cleanly stopped cluster before changing its bind; validate a protected logical backup from a separate recovery copy if the original cannot yet be started safely. Once the intended cluster is running, use the existing [backup and migration checks](migration-operations.md), compare pre-repair data fingerprints, and apply only reviewed forward migrations when pending.

The development app mounts an anonymous `/app/node_modules` volume. Rebuilding its image alone can leave that volume on an older dependency set. After confirming that the newly built development image matches the current lockfile, replace only the app container and its anonymous dependency volume:

```sh
docker compose up -d --no-deps --force-recreate --renew-anon-volumes app
docker compose exec -T app node -p 'require("next/package.json").version'
docker compose exec -T app npm run db:status
```

Verify database health, `/api/health`, and real Google login afterward. Do not use `docker compose down -v` for this repair. The isolated port-3001 POC belongs to its own Compose project and must stay untouched. Main must not enable E2E authentication, Support Inbox mocks, or fixtures; those modes belong to the disposable `saleshub_e2e` database. A locally enabled Inbox route explains that live Gmail requires the configured production environment.

## Weekly snapshot automation

After the snapshot automation migration and application deployment, configure a scheduled Job separately. See [Weekly Snapshot Automation production configuration](../../docs/weekly-snapshot-automation.md#digitalocean-production-configuration-after-reviewed-deployment) for the Monday 05:00 America/New_York schedule, included trigger command, shared secret, HTTPS origin, verification and recovery. Code deployment alone does not install a schedule.
