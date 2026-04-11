# Phase 1: Foundation & Domain Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 01-Foundation & Domain Model
**Areas discussed:** Monorepo structure, Convex <-> Go data sync, Event lifecycle transitions, Guest category model, Dev environment setup, Go API conventions, Infrastructure sizing README, Convex schema design, PostgreSQL scope, Environment & secrets, Deployment strategy, Testing scope, Convex HTTP actions, Admin auth, API versioning, Logging & observability, Go error handling, Database naming conventions, Convex project naming, CORS & security headers, Convex function organization, Redis key naming

---

## Monorepo Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single monorepo | One repo: /frontend, /backend, /convex. Shared .env, single Docker Compose | ✓ |
| Convex inside frontend | Convex dir lives inside /frontend | |

**User's choice:** Single monorepo
**Notes:** None

### Go Backend Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Standard layout | cmd/server/main.go, internal/ packages | ✓ |
| Flat structure | Everything in root backend/ package | |

**User's choice:** Standard layout
**Notes:** None

---

## Convex <-> Go Data Sync

| Option | Description | Selected |
|--------|-------------|----------|
| Replicate to PostgreSQL | Convex pushes changes to PG via HTTP | |
| Go calls Convex API at scan time | Go calls Convex queries during scan validation | |
| Redis cache with Convex source | Event goes live -> Convex pushes to Redis, scans read Redis | ✓ |

**User's choice:** Redis cache with Convex source
**Notes:** User later questioned whether PostgreSQL is needed at all if Convex + Redis covers everything. Flagged as open research question.

### Mid-Event Changes

| Option | Description | Selected |
|--------|-------------|----------|
| Push on change | Every Convex mutation triggers HTTP sync to Go/Redis | ✓ |
| Manual refresh | Admin clicks "Sync to scanners" button | |
| Periodic poll | Go polls Convex every N seconds | |

**User's choice:** Push on change

### PG Replication

| Option | Description | Selected |
|--------|-------------|----------|
| Also replicate to PG | Guest/event data in both Redis and PG | |
| Redis + Convex only | Skip PG replication, PG for scan records only | ✓ |

**User's choice:** Redis + Convex only
**Notes:** User confirmed Convex as source of truth, questioned PG necessity

---

## Event Lifecycle Transitions

| Option | Description | Selected |
|--------|-------------|----------|
| Mostly forward, limited rollback | Forward default, allow completed->live, active->draft | |
| Strictly forward | No backward transitions | |
| Fully flexible | Any transition except from archived | |
| You decide | Claude designs state machine | ✓ |

**User's choice:** You decide (revisited, confirmed "Keep You decide")

### Go-Live Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Manual admin trigger | Admin clicks "Go Live" | |
| Automatic at event date/time | System auto-transitions at scheduled start | ✓ |

**User's choice:** Automatic at event date/time

### Manual Override

| Option | Description | Selected |
|--------|-------------|----------|
| Both: auto + manual override | Auto at schedule + "Go Live Early" button | ✓ |
| Automatic only | No manual override | |

**User's choice:** Both

---

## Guest Category Model

| Option | Description | Selected |
|--------|-------------|----------|
| Fully custom per event | Admin creates arbitrary categories per event | ✓ |
| Predefined with custom | Default categories admin can rename/extend | |
| Fixed set | VIP, Regular, Staff fixed | |

**User's choice:** Fully custom per event

### Default Category

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, auto-assign 'General' | Default category for unassigned guests | ✓ |
| No, require explicit assignment | Every guest must have category | |

**User's choice:** Yes, auto-assign 'General'

---

## Dev Environment Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Docker for infra, native for apps | Docker Compose for PG/Redis, native Go/Vite/Convex | |
| Everything in Docker | All services containerized | |
| You decide | | ✓ |

**User's choice:** You decide

---

## Go API Conventions

| Option | Description | Selected |
|--------|-------------|----------|
| RESTful JSON | Standard REST with JSON, /api/v1/ prefix | ✓ |
| RPC-style JSON | Action-based URLs | |

**User's choice:** RESTful JSON

### Convex -> Go Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Shared secret in header | X-API-Key header | |
| HMAC signed requests | HMAC-SHA256 signed request body | ✓ |

**User's choice:** HMAC signed requests

---

## Infrastructure Sizing README

| Option | Description | Selected |
|--------|-------------|----------|
| 3 tiers | Small/Medium/Large with specs and pricing | ✓ |
| 2 tiers | Dev and production only | |

**User's choice:** 3 tiers with cost estimates

### VPS Providers

**Selected:** Hetzner, DigitalOcean, Vultr, AWS Lightsail
**Excluded:** Hostinger (random suspensions without notice)
**Notes:** Hetzner is preferred (best experience), DigitalOcean as accessible alternative (accepts debit cards)

---

## Convex Schema Design

| Option | Description | Selected |
|--------|-------------|----------|
| Nested object on event | Config as nested field | |
| Separate config table | Normalized, separate table | |
| You decide | | ✓ |

**User's choice:** You decide (for both event config and vendor hierarchy modeling)

---

## PostgreSQL Scope in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Migration framework only | golang-migrate setup, actual tables later | |
| Scaffold all tables now | Full PG schema upfront | |
| You decide | | ✓ |

**User's choice:** You decide

---

## Environment & Secrets

| Option | Description | Selected |
|--------|-------------|----------|
| Single root .env | One .env at project root with prefixed sections | ✓ |
| Separate .env per service | Each service dir has its own .env | |

**User's choice:** Single root .env

---

## Deployment Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Docker image via Dockerfile | Multi-stage Dockerfile, Dokploy deploys container | ✓ |
| Binary deploy | SCP binary, run with systemd | |

**User's choice:** Docker image via Dockerfile

### CI/CD

**User's choice:** Dokploy automatic from GitHub — auto-deploy on push, preview deployments
**Notes:** No separate CI/CD pipeline needed, Dokploy's GitHub integration handles it

---

## Testing Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Framework only | Set up tooling, few smoke tests | |
| Full test coverage | Comprehensive tests for Phase 1 | |
| No tests yet | Skip testing entirely | |
| You decide | | ✓ |

**User's choice:** You decide

---

## Convex HTTP Actions

| Option | Description | Selected |
|--------|-------------|----------|
| Retry with backoff | 3 retries with exponential backoff, log failures | ✓ |
| Fire and forget | Single attempt, periodic reconciliation | |

**User's choice:** Retry with backoff

---

## Admin Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Convex Auth (built-in) / Better Auth | Convex's auth integration | ✓ |
| Clerk | External auth platform | |
| Defer auth | No auth in Phase 1 | |

**User's choice:** Better Auth via Convex
**Notes:** User clarified Convex now uses Better Auth. Admin gets real auth, vendors get passwordless.

---

## API Versioning

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, /api/v1/ from start | Versioned URLs from day 1 | ✓ |
| No prefix, version later | Add versioning only when needed | |

**User's choice:** /api/v1/ from start

---

## Logging & Observability

| Option | Description | Selected |
|--------|-------------|----------|
| Structured logging only | slog with JSON (prod) / text (dev) | ✓ |
| Logging + basic metrics | slog + Prometheus + Grafana | |

**User's choice:** Structured logging only

---

## Go Error Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Domain error types | Typed errors, mapped to HTTP status, JSON response | ✓ |
| Simple error strings | Plain strings with HTTP codes | |

**User's choice:** Domain error types

---

## Database Naming Conventions

| Option | Description | Selected |
|--------|-------------|----------|
| snake_case | PG standard: entry_scans, guest_id | ✓ |
| camelCase everywhere | Match Convex convention | |

**User's choice:** snake_case for PostgreSQL, camelCase for Convex

---

## Convex Project Naming

**User's choice:** "eventarc"

---

## CORS & Security Headers

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Claude configures CORS | ✓ |

**User's choice:** You decide
**Notes:** Critical constraint — full cross-device compatibility (iPhone, iPad, Android). Everything must work: QR scanning, image downloading, vendor UI, admin dashboard.

---

## Convex Function Organization

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Claude picks organization | ✓ |

**User's choice:** You decide

---

## Redis Key Naming

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Claude designs key schema | ✓ |

**User's choice:** You decide

---

## Claude's Discretion

Areas where user deferred to Claude:
- Event lifecycle state transitions
- Dev environment layout
- Convex schema modeling (event config + vendor hierarchy)
- CORS configuration
- Convex function organization
- Redis key naming convention
- PostgreSQL scope in Phase 1
- Testing scope and coverage

## Deferred Ideas

None — discussion stayed within Phase 1 scope
