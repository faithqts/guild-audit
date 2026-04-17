# Guild Audit

Guild Audit is a Node.js + Express web app for guild attendance and character audit data.

## Docker Setup

This repository now includes:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.gitignore`

The Docker image installs dependencies during build with npm and starts the app with Node.

## Environment Variables

Set these in your `.env` file.

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | No | External/internal app port. Default: `3000` |
| `BNET_CLIENT_ID` | Yes | Blizzard API client ID |
| `BNET_CLIENT_SECRET` | Yes | Blizzard API client secret |
| `WCL_CLIENT_ID` | Yes | Warcraft Logs API client ID |
| `WCL_CLIENT_SECRET` | Yes | Warcraft Logs API client secret |
| `GUILD_NAME` | Yes | Guild name |
| `SERVER_SLUG` | Yes | Realm/server slug |
| `SERVER_REGION` | No | Region (default: `us`) |
| `RAIDERIO_SECRET` | No | Raider.IO secret (if used) |
| `CACHE_TTL_MINUTES` | No | Cache TTL in minutes (default: `15`) |
| `AUTH_TOKEN` | No | Token for auth-protected routes |
| `ENABLE_INTERNAL_REFRESH_JOBS` | No | Enable built-in scheduled refresh jobs (default: `true`) |
| `REFRESH_AUDIT_INTERVAL_MINUTES` | No | Audit refresh interval in minutes (default: `15`) |
| `REFRESH_PLAYERS_INTERVAL_MINUTES` | No | Player refresh interval in minutes (default: `5`) |
| `REFRESH_JOBS_RUN_ON_START` | No | Run both scheduled refresh jobs immediately on startup (default: `false`) |
| `REFRESH_SECRET` | No | Secret only for manual `/api/refresh/*` calls |

Note: the app accepts `AUTH_TOKEN` (preferred), and also supports legacy variants used in code.

## Automatic Refresh (No External Cron Required)

The container now runs internal refresh jobs by default, so host-level cron is not required.

- Audit refresh every 15 minutes (`REFRESH_AUDIT_INTERVAL_MINUTES=15`)
- Player refresh every 5 minutes (`REFRESH_PLAYERS_INTERVAL_MINUTES=5`)

This replaces cron jobs like:

```cron
*/15 * * * * curl -X POST http://localhost:48080/api/refresh/audit -H "Authorization: Bearer TOKEN"
*/5 * * * * curl -X POST http://localhost:48080/api/refresh/players -H "Authorization: Bearer TOKEN"
```

Because refresh runs internally now, `REFRESH_SECRET` is not required unless you still want to call refresh endpoints manually.

## Run With Docker Compose

1. Ensure your `.env` file has the values above.
2. Build and start:

```bash
docker compose up --build -d
```

3. Open:

```text
http://localhost:${PORT:-3000}
```

Stop the stack:

```bash
docker compose down
```

The compose file mounts:

- `./cache` -> `/app/cache`
- `./personal_data.json` -> `/app/personal_data.json`

so runtime cache and personal data changes persist across container restarts.

## Portainer Notes

For Portainer stacks, upload your `.env` in Portainer when deploying the stack.

- The compose file intentionally does **not** use `env_file`.
- Environment values are provided through variable substitution from Portainer's uploaded `.env`.

## Local Node Run (Without Docker)

```bash
npm install
node main.js
```