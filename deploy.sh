#!/usr/bin/env bash
# ============================================================================
# EventArc — One-Command Deploy Script
# ============================================================================
# Deploys the full EventArc stack on a fresh VPS with Docker.
#
# Usage:
#   git clone https://github.com/your-org/eventarc.git && cd eventarc
#   cp .env.production.example .env
#   # Edit .env with your values
#   chmod +x deploy.sh && ./deploy.sh
#
# Requirements: Docker 24+, Docker Compose v2+, git
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[EventArc]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────
log "Running pre-flight checks..."

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed."

if [ ! -f .env ]; then
    fail ".env file not found. Copy .env.production.example to .env and fill in values."
fi

# Source .env for validation
set -a; source .env; set +a

[ -z "${HMAC_SECRET:-}" ]       && fail "HMAC_SECRET is not set in .env"
[ -z "${PG_PASSWORD:-}" ]       && fail "PG_PASSWORD is not set in .env"
[ -z "${FRONTEND_DOMAIN:-}" ]   && fail "FRONTEND_DOMAIN is not set in .env"
[ -z "${API_DOMAIN:-}" ]        && fail "API_DOMAIN is not set in .env"
[ -z "${VITE_CONVEX_URL:-}" ]   && fail "VITE_CONVEX_URL is not set in .env"

if [ ${#HMAC_SECRET} -lt 32 ]; then
    fail "HMAC_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32"
fi

ok "Pre-flight checks passed"

# ── Detect deployment mode ────────────────────────────────────────────
COMPOSE_FILE="docker-compose.vps.yml"

if docker network inspect dokploy-network >/dev/null 2>&1; then
    log "Dokploy detected — using docker-compose.production.yml"
    COMPOSE_FILE="docker-compose.production.yml"
else
    log "Standalone VPS — using docker-compose.vps.yml (Caddy for HTTPS)"
fi

# ── Build and deploy ──────────────────────────────────────────────────
log "Building and starting services..."
docker compose -f "$COMPOSE_FILE" build --parallel
docker compose -f "$COMPOSE_FILE" up -d

# ── Run database migrations ───────────────────────────────────────────
log "Waiting for PostgreSQL to be ready..."
sleep 5

# Check if golang-migrate is available locally
if command -v migrate >/dev/null 2>&1; then
    log "Running database migrations..."
    migrate -path backend/migrations \
        -database "postgres://eventarc:${PG_PASSWORD}@localhost:5432/eventarc?sslmode=disable" up \
        2>&1 || warn "Migration failed — you may need to run migrations manually (see below)"
else
    warn "golang-migrate not found locally."
    echo ""
    echo "  Run migrations manually from a machine with migrate installed:"
    echo ""
    echo "    migrate -path backend/migrations \\"
    echo "      -database \"postgres://eventarc:\${PG_PASSWORD}@<server-ip>:5432/eventarc?sslmode=disable\" up"
    echo ""
    echo "  Or exec into the postgres container:"
    echo ""
    echo "    docker compose -f $COMPOSE_FILE exec -T postgres psql -U eventarc eventarc < backend/migrations/000001_init.up.sql"
    echo ""
fi

# ── Health check ──────────────────────────────────────────────────────
log "Checking service health..."
sleep 10

HEALTHY=true
for svc in postgres pgbouncer redis api; do
    STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json "$svc" 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || echo "")
    if echo "$STATUS" | grep -q "healthy"; then
        ok "$svc is healthy"
    else
        warn "$svc may still be starting (check: docker compose -f $COMPOSE_FILE ps)"
        HEALTHY=false
    fi
done

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo -e "${GREEN} EventArc deployed successfully!${NC}"
echo "============================================"
echo ""
echo "  Frontend:  https://${FRONTEND_DOMAIN}"
echo "  API:       https://${API_DOMAIN}"
echo "  API Health: https://${API_DOMAIN}/api/v1/health"
echo ""
echo "  Compose:   $COMPOSE_FILE"
echo ""
echo "  Useful commands:"
echo "    docker compose -f $COMPOSE_FILE logs -f        # Follow all logs"
echo "    docker compose -f $COMPOSE_FILE logs -f api    # Follow API logs"
echo "    docker compose -f $COMPOSE_FILE ps             # Service status"
echo "    docker compose -f $COMPOSE_FILE restart api    # Restart API"
echo "    docker compose -f $COMPOSE_FILE down           # Stop all"
echo ""

if [ "$COMPOSE_FILE" = "docker-compose.vps.yml" ]; then
    echo "  Caddy auto-HTTPS:"
    echo "    Make sure DNS A records point to this server:"
    echo "      ${FRONTEND_DOMAIN} → $(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
    echo "      ${API_DOMAIN}      → $(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
    echo ""
fi

echo "  Next steps:"
echo "    1. Set Convex env vars in dashboard (GO_API_URL=https://${API_DOMAIN})"
echo "    2. Run: npx convex deploy"
echo "    3. Open https://${FRONTEND_DOMAIN} and register first admin account"
echo ""
