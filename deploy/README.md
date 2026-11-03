# Deployment

Runs as its own Docker project on a host it shares with other services. Only Caddy publishes ports
(80, 443); API and PostgreSQL stay on the project's internal network.

## Images

The `Images` workflow tests the production images on every PR and on `main`. On `main` it also pushes
`ghcr.io/momoathome/orions-frontier-{api,web}:<commit-sha>`, once the repository variable
`PUBLIC_DOMAIN` is set. The domain is baked into the frontend, so changing it needs a new build.

## First deploy

1. Point an A record for the domain at the server.
2. Set `PUBLIC_DOMAIN` as a repository variable and let the workflow run on `main`.
3. On the server, in `/opt/orions-frontier`: set `DOMAIN` in `.env` to the same value.
4. Allow 80 and 443 in any cloud firewall in front of the server.
5. Deploy the commit:

   ```bash
   ssh root@<server> /opt/orions-frontier/deploy.sh <full-commit-sha>
   ```

## Updating the server's files

`compose.prod.yaml`, `deploy/deploy.sh` and `deploy/backup.sh` live flat in `/opt/orions-frontier`.
Copy them again when they change. `.env` and `backups/` exist only on the server.

## Rollback

Deploy the previous SHA. If a migration ran in between, stop the API, restore the dump, then deploy:

```bash
docker compose -f compose.prod.yaml stop api web
docker compose -f compose.prod.yaml exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/<file>.dump
```

## Backups

`deploy.sh` dumps before each deploy. For a daily dump, add this to root's crontab:

```cron
30 3 * * * /opt/orions-frontier/backup.sh >/dev/null
```

Dumps stay on the server, so they need a copy elsewhere to survive losing it.

## Sharing the host

Never run `docker system prune`, restart the Docker daemon or reset ufw here: each one can take other
services on the host down with it.
