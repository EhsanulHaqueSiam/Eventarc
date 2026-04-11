# Phase 7: Offline Resilience - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-12
**Phase:** 07-offline-resilience
**Areas discussed:** Offline scan behavior, Sync & re-validation, Offline data model

---

## Offline Scan Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Optimistic approved (yellow/amber) | Show amber approval, sync later | |
| Clear 'queued' state (no approval) | Show "Scan Queued — will validate when online" | ✓ |
| You decide | Claude picks | |

**User's choice:** Clear 'queued' state

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — client-side limit tracking | Cache consumption, track locally | |
| No — just queue everything | No local limits, server validates on reconnect | ✓ |
| You decide | Claude picks | |

**User's choice:** No — just queue everything

---

## Sync & Re-validation

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential in timestamp order | Process one by one in order | ✓ |
| Batch submit, server handles order | Send all at once | |
| You decide | Claude picks | |

**User's choice:** Sequential in timestamp order

---

| Option | Description | Selected |
|--------|-------------|----------|
| Toast notification with details | Persistent toast per rejected scan | ✓ |
| Sync results summary | Summary after all processed | |
| You decide | Claude picks | |

**User's choice:** Toast notification with details

---

## Offline Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Until event ends | Keep for entire event | |
| 30-minute window | Delete scans older than 30 min | ✓ |
| You decide | Claude picks | |

**User's choice:** 30-minute window

---

## Claude's Discretion

- IndexedDB schema design
- Network detection mechanism
- Sync retry strategy
- Offline indicator UI design
- Queued scan list display
- Cleanup scheduling

## Deferred Ideas

None
