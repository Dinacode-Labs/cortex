# Deploying Cortex

A single host with Docker. Caddy in front (automatic TLS), and behind it the API, the UI, the
MCP, Postgres, a maintenance worker and daily backups.

```
https://<domain>/            → the web UI
https://<domain>/api/*       → the API (Caddy strips the prefix)
https://<domain>/mcp         → MCP over HTTP
https://<domain>/install.sh  → the CLI installer
```

Only Caddy publishes ports. Postgres never faces the internet.

## Requirements

- Docker >= 24 with Compose v2.
- A domain pointing at the host (an A/AAAA record) and ports 80 and 443 open. Caddy needs 80 to
  validate the certificate, not just 443.
- Access to the image: `docker login ghcr.io` when the package is private.

## First deployment

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env          # it holds Postgres's password and the providers' keys
$EDITOR deploy/.env            # domain, passwords, email, providers

docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps      # everything must come up healthy
```

Check that it answers:

```bash
curl -s https://<domain>/api/health     # {"ok":true,"service":"cortex-server","db":"ok"}
curl -s https://<domain>/health         # the UI
curl -si https://<domain>/mcp | head -1 # 401: it is alive and asking for authentication
```

And from somebody's laptop:

```bash
curl -fsSL https://<domain>/install.sh | sh
cortex link --create "My Project"
cortex doctor
```

What to check before calling the deployment good:

- `CORTEX_AUTH_DOMAIN` is not empty. Empty means any email address in the world can register.
  The server warns about it on startup; look for it in the logs.
- `CORTEX_EMAIL_PROVIDER` is not `log`. With `log`, the sign-in code is only printed to the
  server's logs and nobody can get in.
- `CORTEX_VERSION` is a specific version, not `latest`. With `latest`, a restart can change
  version without anybody having decided to.

## Updating

```bash
$EDITOR deploy/.env    # CORTEX_VERSION=0.2.0
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

The migrations apply themselves: the `migrate` service runs before the others and they wait for
it to finish successfully.

**Going back is not symmetric.** Migrations only move forward, so lowering the image's version
works as long as the newer version has not migrated the schema. If it did, the previous backup
has to be restored. That is why a manual backup before a large update is worth it:
`./deploy/backup-now.sh`.

## Backups

Daily and automatic, with a retention of 7 days, 4 weeks and 6 months, in the
`cortex-deploy_cortex-backups` volume.

```bash
./deploy/backup-now.sh     # a backup right now
docker compose -f deploy/docker-compose.yml cp backup:/backups ./backups-copy
```

**Get them off the host.** A backup that lives on the same machine as the database does not
protect against the case that matters most, which is losing the machine.

## Restoring

```bash
./deploy/restore.sh <backup.sql.gz>                             # replaces the real database
./deploy/restore.sh <backup.sql.gz> --target-db cortex_drill    # a drill, touching nothing
```

**Run the drill every month.** A backup that has never been restored is not a backup, it is a
file. The drill restores into a separate database and counts the entries.

## Rotating credentials

- **LLM, embedding and SMTP keys**: change them in `deploy/.env` and
  `docker compose -f deploy/docker-compose.yml up -d`. Nothing needs migrating.
- **Postgres's password**: change it in the database first
  (`ALTER USER cortex WITH PASSWORD '…'`), and afterwards in `POSTGRES_PASSWORD` and in
  `DATABASE_URL`, which have to match. If you only change the `.env`, the services stop
  connecting.
- **User tokens**: all of them are invalidated by clearing the sessions table. That is what to
  do when a token leaks or somebody leaves the team.

## Logs

```bash
docker compose -f deploy/docker-compose.yml logs -f server
docker compose -f deploy/docker-compose.yml logs -f caddy   # certificates and requests
```

## Security

- Only Caddy publishes ports; Postgres and the apps live on the internal network.
- With `NODE_ENV=production` the session cookie is `secure`, so the UI works **only** over
  HTTPS.
- Security headers set by all three apps, and HSTS by Caddy.
- The containers run as the `node` user, not as root.
- `deploy/.env` holds secrets: `chmod 600` and never into the repository.

## Development

This is the deployment. To work on the code, `pnpm db:up` brings up Postgres alone on port 5433
and everything else runs locally. The two composes are deliberately isolated: their volumes
never touch, and a `down -v` in one does not take the other's data with it.
