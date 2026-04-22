# AI-Assisted Deployment Prompt

Copy the prompt below and paste it into Claude, ChatGPT, Codex, or any AI coding assistant. It contains everything the AI needs to deploy EventArc on your server.

Before using the prompt, have these ready:
- A VPS with SSH access and Docker installed (Hetzner CX22+ recommended)
- A domain name with DNS access
- A Convex account (free at [convex.dev](https://convex.dev))
- A Cloudflare account with R2 enabled (free tier works)
- (Optional) An SMS provider API key (sms.net.bd or similar)

---

## The Prompt

````
I need you to deploy EventArc — a multi-event management platform — on my server. The project repo is https://github.com/EhsanulHaqueSiam/Eventarc.git

Here is the full context you need:

## What EventArc Is

A multi-event management platform for large-scale events (up to 60K attendees, 10K concurrent). Features: QR-based entry control, food distribution tracking, real-time admin dashboards, bulk SMS invitations with custom card designs, and offline-capable vendor scanning stations.

## Architecture (6 services)

1. **Frontend** — React SPA served by nginx (port 80 internal)
2. **Go API Server** — HTTP API + SSE + WebSocket for scan processing (port 8080 internal)
3. **Go Worker** — Background jobs via asynq: QR generation, card compositing, SMS delivery
4. **PostgreSQL 17** — Durable scan storage (entry_scans, food_scans, event_counters tables)
5. **PgBouncer 1.25** — Connection pooling (150 pool, 10K max clients, transaction mode)
6. **Redis 8** — Atomic counters, Lua-scripted scan dedup, pub/sub for SSE, asynq job queue

Plus external services:
- **Convex** (cloud) — CRUD, real-time subscriptions, auth (Better Auth)
- **Cloudflare R2** — QR/card image storage with zero-egress CDN
- **SMS Provider** — sms.net.bd (optional, for invitation SMS)

## Deployment Steps

### 1. Server Preparation

SSH into the server. Ensure Docker 24+ and Docker Compose v2+ are installed. Open ports 80 and 443 in the firewall.

### 2. Clone and Configure

```bash
git clone https://github.com/EhsanulHaqueSiam/Eventarc.git
cd Eventarc
cp .env.production.example .env
```

### 3. Generate Secrets

```bash
# Generate HMAC secret (minimum 32 bytes, shared between Go backend and Convex)
openssl rand -hex 32
# Generate PostgreSQL password
openssl rand -hex 24
```

### 4. Fill in .env

These are ALL the variables that need to be set:

```
# Domains — the two DNS A records pointing to this server
FRONTEND_DOMAIN=app.yourdomain.com
API_DOMAIN=api.yourdomain.com

# Security
HMAC_SECRET=<generated-hex-64-chars>
PG_PASSWORD=<generated-hex-48-chars>

# Convex (from `npx convex deploy` output and Convex dashboard)
# .convex.cloud = client SDK host; .convex.site = HTTP actions host.
# CONVEX_URL (used by Go backend) MUST be the .convex.site host.
VITE_CONVEX_URL=https://<project>.convex.cloud
VITE_CONVEX_SITE_URL=https://<project>.convex.site
CONVEX_URL=https://<project>.convex.site

# Frontend needs to know API URL
VITE_API_URL=https://api.yourdomain.com

# Cloudflare R2 (from Cloudflare dashboard > R2 > Manage R2 API Tokens)
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET_NAME=eventarc-qr
R2_PUBLIC_URL=https://cdn.yourdomain.com

# SMS (optional — leave empty to skip SMS feature)
SMS_PROVIDER_API_KEY=
SMS_PROVIDER_SENDER_ID=
SMS_PROVIDER_BASE_URL=https://api.sms.net.bd
```

### 5. DNS Setup

Create two A records pointing to the server IP:
- `app.yourdomain.com` → server IP
- `api.yourdomain.com` → server IP

If using Cloudflare R2 with custom domain:
- `cdn.yourdomain.com` → configured in Cloudflare R2 custom domain settings

### 6. Deploy

The repo includes two Docker Compose files:

- **`docker-compose.production.yml`** — For Dokploy (uses Traefik + dokploy-network)
- **`docker-compose.vps.yml`** — For standalone VPS (includes Caddy for auto-HTTPS)

**If using Dokploy:**
```bash
docker compose -f docker-compose.production.yml up -d --build
```

**If standalone VPS (recommended):**
```bash
./deploy.sh
# OR manually:
docker compose -f docker-compose.vps.yml up -d --build
```

The deploy.sh script auto-detects whether Dokploy is installed and picks the right compose file.

### 7. Run Database Migrations

Migrations run against PostgreSQL DIRECTLY (port 5432), not through PgBouncer:

```bash
# Option A: if golang-migrate is installed
migrate -path backend/migrations \
  -database "postgres://eventarc:$PG_PASSWORD@localhost:5432/eventarc?sslmode=disable" up

# Option B: apply SQL files directly
for f in backend/migrations/*.up.sql; do
  docker compose -f <compose-file> exec -T postgres psql -U eventarc eventarc < "$f"
done
```

Migration files in order:
1. `000001_init.up.sql` — base schema
2. `000002_scan_processing.up.sql` — entry scan tables + indexes
3. `000003_food_scans.up.sql` — food scan tracking
4. `000004_additional_guests.up.sql` — additional guest fields

### 8. Set Convex Environment Variables

In the Convex Dashboard (dashboard.convex.dev) > your project > Settings > Environment Variables:

| Variable | Value |
|----------|-------|
| `GO_API_URL` | `https://api.yourdomain.com` |
| `HMAC_SECRET` | Same value as in .env |
| `SITE_URL` | `https://app.yourdomain.com` |
| `CONVEX_SITE_URL` | `https://<project>.convex.site` |
| `NODE_ENV` | `production` |

### 9. Deploy Convex Functions

From your local machine (not the server):
```bash
npx convex deploy
```

### 10. Verify

```bash
# Check all services are healthy
docker compose -f <compose-file> ps

# Test API health
curl https://api.yourdomain.com/api/v1/health

# Open frontend
# https://app.yourdomain.com
# Register — first user automatically becomes admin
```

## Key Files in the Repo

| File | Purpose |
|------|---------|
| `docker-compose.production.yml` | Dokploy deployment (Traefik labels) |
| `docker-compose.vps.yml` | Standalone VPS (includes Caddy) |
| `docker-compose.yml` | Local development only |
| `deploy.sh` | One-command deploy script |
| `.env.production.example` | All env vars documented |
| `frontend/Dockerfile` | Frontend: node build → nginx serve |
| `backend/Dockerfile` | Backend: multi-target (server + worker) |
| `deploy/Caddyfile` | Caddy reverse proxy config |
| `backend/migrations/` | PostgreSQL migration SQL files |
| `docs/DEPLOY.md` | Full deployment guide |
| `docs/SIZING-GUIDE.md` | VPS sizing recommendations |

## Sizing Recommendations

| Scale | VPS | RAM | Monthly Cost |
|-------|-----|-----|-------------|
| 8K guests, 1K concurrent | Hetzner CX22 | 4GB | ~$5-12 |
| 30K guests, 5K concurrent | Hetzner CX32 | 8GB | ~$45-59 |
| 60K guests, 10K concurrent | Hetzner CX42 | 16GB | ~$65-93 |

## Troubleshooting

- **Frontend blank page**: `VITE_CONVEX_URL` and `VITE_API_URL` must be set at Docker BUILD time (they're baked into the JS bundle)
- **API 502**: Check `docker compose logs api` — usually missing HMAC_SECRET or DB connection
- **Scans fail**: Check Redis: `docker compose exec redis redis-cli ping`
- **SSE not working**: `ALLOWED_ORIGINS` must include the frontend domain (e.g., `https://app.yourdomain.com`)
- **Caddy no SSL**: Ports 80/443 must be open, DNS must resolve before Caddy starts

## What I Need From You

Please guide me through each step. Ask me for:
1. My server IP and domain names
2. Help me generate secrets
3. Walk me through Convex project setup if I haven't done it
4. Walk me through Cloudflare R2 bucket creation if I haven't done it
5. Help me fill in .env correctly
6. Deploy and verify everything works

My server details:
- Provider: [Hetzner/DigitalOcean/other]
- IP: [your server IP]
- OS: [Ubuntu 22.04/24.04/etc]
- Domain: [yourdomain.com]
- Dokploy installed: [yes/no]
````

---

## Usage Tips

- **Claude Code / Codex**: If you're using Claude Code or Codex CLI with SSH access to the server, the AI can run the commands directly. Just paste the prompt and add "I have SSH access, please run the commands for me."

- **ChatGPT / Claude web**: The AI will give you commands to copy-paste into your terminal. Fill in the "My server details" section at the bottom of the prompt before sending.

- **Partial deploys**: If you've already done some steps (e.g., Convex is already set up), mention that in the prompt and the AI will skip those steps.
