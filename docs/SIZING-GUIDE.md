# Infrastructure Sizing Guide

Recommended server configurations for EventArc based on your event scale.

## Small (up to 8,000 guests)

| Resource | Specification |
|---|---|
| Max Guests | 8,000 |
| Concurrent Users | 1,000 |
| VPS | CX22 (2 vCPU, 4GB RAM) |
| PostgreSQL | 2GB RAM |
| Redis | 512MB |
| PgBouncer Pool | 50 |
| Convex | Free tier |

### Estimated Cost

| Service | Price |
|---|---|
| Hetzner CX22 | ~$5/mo |
| DigitalOcean Basic | ~$12/mo |
| Redis (Upstash Free) | $0 |
| Convex Free | $0 |
| **Total** | **~$5-12/mo** |

---

## Medium (up to 30,000 guests)

| Resource | Specification |
|---|---|
| Max Guests | 30,000 |
| Concurrent Users | 5,000 |
| VPS | CX32 (4 vCPU, 8GB RAM) |
| PostgreSQL | 4GB RAM |
| Redis | 1GB |
| PgBouncer Pool | 100 |
| Convex | Pro ($25/month) |

### Estimated Cost

| Service | Price |
|---|---|
| Hetzner CX32 | ~$10/mo |
| DigitalOcean Premium | ~$24/mo |
| Redis (Upstash Pro) | ~$10/mo |
| Convex Pro | $25/mo |
| **Total** | **~$45-59/mo** |

---

## Large (up to 60,000 guests)

| Resource | Specification |
|---|---|
| Max Guests | 60,000 |
| Concurrent Users | 10,000 |
| VPS | CX42 (8 vCPU, 16GB RAM) |
| PostgreSQL | 8GB RAM |
| Redis | 2GB |
| PgBouncer Pool | 150 |
| Convex | Pro ($25/month) |

### Estimated Cost

| Service | Price |
|---|---|
| Hetzner CX42 | ~$20/mo |
| DigitalOcean Premium | ~$48/mo |
| Redis (Upstash Business) | ~$20/mo |
| Convex Pro | $25/mo |
| **Total** | **~$65-93/mo** |

---

## Environment Notes

- **Development/Staging:** VPS + Dokploy + Convex free tier. Redis via Upstash free tier or Docker on Dokploy.
- **Production:** Swap Convex keys to Pro plan. Scale VPS and Redis based on the tier matching your event size.
- **Recommended providers:** Hetzner (best value), DigitalOcean (debit card friendly). Vultr and AWS Lightsail are alternatives.

> **Warning:** Hostinger is NOT recommended due to reports of random account suspensions without notice.
