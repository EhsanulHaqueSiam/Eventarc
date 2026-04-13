# Deployment Guide

Three deployment options, from easiest to most manual.

---

## Option 1: Dokploy (Recommended)

Dokploy is a self-hosted PaaS that runs on any VPS. It handles builds, SSL, domains, logs, and monitoring through a web UI.

### Prerequisites

- A VPS with Dokploy installed ([docs.dokploy.com](https://docs.dokploy.com))
- Two DNS A records pointing to your server:
  - `app.yourdomain.com` (frontend)
  - `api.yourdomain.com` (API)
- A Convex project deployed (`npx convex deploy`)
- Cloudflare R2 bucket created (for QR/card images)

### Steps

1. **Create a Docker Compose application** in Dokploy dashboard

2. **Point to your repository** and set the compose path to:
   ```
   docker-compose.production.yml
   ```

3. **Add environment variables** in Dokploy UI (Settings > Environment):

   | Variable | Example |
   |----------|---------|
   | `FRONTEND_DOMAIN` | `app.yourdomain.com` |
   | `API_DOMAIN` | `api.yourdomain.com` |
   | `HMAC_SECRET` | `openssl rand -hex 32` |
   | `PG_PASSWORD` | `openssl rand -hex 24` |
   | `VITE_CONVEX_URL` | `https://your-project.convex.cloud` |
   | `VITE_CONVEX_SITE_URL` | `https://your-project.convex.site` |
   | `VITE_API_URL` | `https://api.yourdomain.com` |
   | `CONVEX_URL` | `https://your-project.convex.cloud` |
   | `CONVEX_DEPLOYMENT_TOKEN` | From Convex dashboard |
   | `R2_ACCOUNT_ID` | Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | R2 API token |
   | `R2_SECRET_ACCESS_KEY` | R2 API secret |
   | `R2_BUCKET_NAME` | `eventarc-qr` |
   | `R2_PUBLIC_URL` | `https://cdn.yourdomain.com` |

   Optional:
   | Variable | Default | Description |
   |----------|---------|-------------|
   | `SMS_PROVIDER_API_KEY` | | Required for SMS feature |
   | `GOMAXPROCS` | `4` | API server CPU cores |
   | `WORKER_GOMAXPROCS` | `2` | Worker CPU cores |
   | `REDIS_MAXMEMORY` | `256mb` | Redis memory limit |
   | `ASYNQ_CONCURRENCY` | `64` | Background job parallelism |

4. **Add domains** in Dokploy UI (Domains tab):
   - `app.yourdomain.com` → service `frontend`, port `80`
   - `api.yourdomain.com` → service `api`, port `8080`

   Or use the Traefik labels already in the compose file (they use `FRONTEND_DOMAIN` and `API_DOMAIN` env vars).

5. **Deploy** — click Deploy in Dokploy

6. **Run database migrations** — SSH into your server:
   ```bash
   # Find the postgres container
   docker ps | grep postgres

   # Apply migrations
   cat backend/migrations/000001_init.up.sql | docker exec -i <postgres-container> psql -U eventarc eventarc
   cat backend/migrations/000002_scan_processing.up.sql | docker exec -i <postgres-container> psql -U eventarc eventarc
   cat backend/migrations/000003_food_scans.up.sql | docker exec -i <postgres-container> psql -U eventarc eventarc
   cat backend/migrations/000004_additional_guests.up.sql | docker exec -i <postgres-container> psql -U eventarc eventarc
   ```

7. **Set Convex environment variables** in [Convex Dashboard](https://dashboard.convex.dev) > Settings > Environment Variables:

   | Variable | Value |
   |----------|-------|
   | `GO_API_URL` | `https://api.yourdomain.com` |
   | `HMAC_SECRET` | Same as your `.env` |
   | `SITE_URL` | `https://app.yourdomain.com` |
   | `CONVEX_SITE_URL` | `https://your-project.convex.site` |
   | `NODE_ENV` | `production` |

8. **Open** `https://app.yourdomain.com`, register — first user becomes admin.

### Auto-Deploy

Enable webhooks in Dokploy to auto-deploy on push to your main branch.

---

## Option 2: Any VPS with Docker (Caddy auto-HTTPS)

For any VPS without Dokploy. Uses Caddy for automatic HTTPS certificates.

### Prerequisites

- A VPS (Hetzner CX22+ recommended, see [SIZING-GUIDE.md](SIZING-GUIDE.md))
- Docker 24+ and Docker Compose v2+
- Two DNS A records pointing to your server IP
- A Convex project deployed

### Steps

```bash
# 1. Clone and configure
git clone https://github.com/your-org/eventarc.git
cd eventarc
cp .env.production.example .env

# 2. Edit .env with your values
nano .env    # or vim, etc.

# 3. Deploy (auto-detects VPS vs Dokploy)
./deploy.sh
```

The deploy script will:
- Validate all required env vars
- Auto-detect Dokploy (uses Traefik) vs standalone (uses Caddy)
- Build all containers in parallel
- Start the full stack
- Run migrations if `golang-migrate` is installed
- Print health check results and next steps

### Manual alternative

```bash
# Build and start
docker compose -f docker-compose.vps.yml up -d --build

# Check status
docker compose -f docker-compose.vps.yml ps

# Run migrations
migrate -path backend/migrations \
  -database "postgres://eventarc:$PG_PASSWORD@localhost:5432/eventarc?sslmode=disable" up

# View logs
docker compose -f docker-compose.vps.yml logs -f
```

### SSL

Caddy automatically obtains and renews Let's Encrypt certificates. Ensure:
- Ports 80 and 443 are open in your firewall
- DNS A records resolve to your server IP before starting

---

## Option 3: Manual Deployment (Separate Services)

For custom setups where you want to run services individually.

### Infrastructure

Start PostgreSQL, PgBouncer, and Redis:

```bash
docker compose up -d postgres pgbouncer redis
```

### Go API Server

```bash
cd backend
go build -o server ./cmd/server
ENV=production \
  HMAC_SECRET=your-secret \
  DATABASE_URL="postgres://eventarc:pass@localhost:6432/eventarc?sslmode=disable" \
  REDIS_URL="redis://localhost:6379" \
  ALLOWED_ORIGINS="https://app.yourdomain.com" \
  ./server
```

### Go Worker

```bash
cd backend
go build -o worker ./cmd/worker
ENV=production \
  HMAC_SECRET=your-secret \
  DATABASE_URL="postgres://eventarc:pass@localhost:6432/eventarc?sslmode=disable" \
  REDIS_URL="redis://localhost:6379" \
  ./worker
```

### Frontend

```bash
cd frontend
VITE_CONVEX_URL=https://your-project.convex.cloud \
  VITE_API_URL=https://api.yourdomain.com \
  pnpm build

# Serve dist/ with nginx, Caddy, or any static file server
```

### Convex

```bash
npx convex deploy
```

---

## Architecture in Production

```
                 DNS
                  │
          ┌───────┴───────┐
          ▼               ▼
   app.domain.com   api.domain.com
          │               │
          ▼               ▼
  ┌──────────────────────────────┐
  │    Caddy / Traefik (HTTPS)   │
  └──────┬───────────┬───────────┘
         │           │
         ▼           ▼
    ┌─────────┐ ┌─────────┐
    │Frontend │ │Go API   │──► Redis ──► Go Worker
    │ (nginx) │ │Server   │──► PgBouncer ──► PostgreSQL
    └─────────┘ └─────────┘
                     │
                     ▼
                  Convex (cloud)
```

**Services:**
| Service | Port | Exposed | Purpose |
|---------|------|---------|---------|
| Frontend (nginx) | 80 | Via proxy | Static SPA |
| Go API Server | 8080 | Via proxy | Scan processing, SSE, sessions |
| Go Worker | - | No | Background jobs (QR, cards, SMS) |
| PostgreSQL | 5432 | No | Durable scan storage |
| PgBouncer | 6432 | No | Connection pooling |
| Redis | 6379 | No | Cache, counters, pub/sub, jobs |
| Caddy | 80, 443 | Yes | Reverse proxy, auto-HTTPS |

---

## Database Migrations

Migrations must be run against PostgreSQL directly (not PgBouncer) because they use DDL statements.

```bash
# If you have golang-migrate installed:
migrate -path backend/migrations \
  -database "postgres://eventarc:$PG_PASSWORD@<host>:5432/eventarc?sslmode=disable" up

# Or apply manually via psql:
docker exec -i <postgres-container> psql -U eventarc eventarc < backend/migrations/000001_init.up.sql
docker exec -i <postgres-container> psql -U eventarc eventarc < backend/migrations/000002_scan_processing.up.sql
docker exec -i <postgres-container> psql -U eventarc eventarc < backend/migrations/000003_food_scans.up.sql
docker exec -i <postgres-container> psql -U eventarc eventarc < backend/migrations/000004_additional_guests.up.sql
```

---

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose -f <compose-file> up -d --build

# Run any new migrations
migrate -path backend/migrations \
  -database "postgres://eventarc:$PG_PASSWORD@localhost:5432/eventarc?sslmode=disable" up
```

For Dokploy: just push to your repo — webhooks handle the rest.

---

## Monitoring

### Logs

```bash
# All services
docker compose -f <compose-file> logs -f

# Specific service
docker compose -f <compose-file> logs -f api
docker compose -f <compose-file> logs -f worker
```

### Health Checks

```bash
# API health
curl https://api.yourdomain.com/api/v1/health

# Service status
docker compose -f <compose-file> ps
```

### Backups

```bash
# PostgreSQL backup
docker exec <postgres-container> pg_dump -U eventarc eventarc > backup_$(date +%Y%m%d).sql

# Redis backup (AOF is already persistent via volume)
docker exec <redis-container> redis-cli BGSAVE

# Restore PostgreSQL
cat backup_20260414.sql | docker exec -i <postgres-container> psql -U eventarc eventarc
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Frontend shows blank page | Check `VITE_CONVEX_URL` and `VITE_API_URL` are set correctly at build time |
| API returns 502 | Check `docker compose logs api` — likely missing env vars |
| Scans fail with 500 | Check Redis is healthy: `docker compose exec redis redis-cli ping` |
| SSE dashboard not updating | Check `ALLOWED_ORIGINS` includes your frontend domain |
| Worker not processing jobs | Check `docker compose logs worker` — verify Redis connection |
| Caddy can't get SSL cert | Ensure ports 80/443 are open and DNS resolves to server IP |
| PgBouncer connection refused | Check `PG_PASSWORD` matches between postgres and pgbouncer services |
