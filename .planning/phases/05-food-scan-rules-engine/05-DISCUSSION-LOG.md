# Phase 5: Food Scan & Rules Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 05-food-scan-rules-engine
**Areas discussed:** Food rules configuration, Cross-stall enforcement, Anonymous mode mechanics, Food scan response

---

## Food Rules Configuration

| Option | Description | Selected |
|--------|-------------|----------|
| Matrix table (guest categories x food categories) | Grid with limits at each intersection | ✓ |
| Per-guest-category rule cards | Step-by-step per category | |
| You decide | Claude picks | |

**User's choice:** Matrix table

---

| Option | Description | Selected |
|--------|-------------|----------|
| Numeric + unlimited option | Number or unlimited toggle | ✓ |
| Numeric only (0 = disabled) | Only numbers, high number = unlimited | |
| You decide | Claude picks | |

**User's choice:** Numeric + unlimited option

---

## Cross-Stall Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Redis hash per guest per event | HINCRBY on hash fields per food category | |
| Redis sorted set per category | Members as guestIds with consumption scores | |
| You decide | Claude picks optimal structure | ✓ |

**User's choice:** You decide (Claude's discretion)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Lua script (single atomic operation) | Read + check + increment in one EVAL | ✓ |
| Pipeline with optimistic check | HINCRBY then check, rollback if over | |
| You decide | Claude picks | |

**User's choice:** Lua script (single atomic operation)

---

## Anonymous Mode Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| QR payload hash as token ID | Hash of binary payload as Redis key | |
| Separate token UUID stored in QR | UUID embedded in QR payload | |
| You decide | Claude picks based on Phase 3 payload format | ✓ |

**User's choice:** You decide (Claude's discretion)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Same matrix rules apply | Anonymous tokens inherit guest category limits | ✓ |
| Flat per-token limits | Single set of limits for all anonymous tokens | |
| You decide | Claude picks | |

**User's choice:** Same matrix rules apply

---

## Food Scan Response

| Option | Description | Selected |
|--------|-------------|----------|
| Remaining allowance per category | Show current count, remaining, full picture | ✓ |
| Just 'approved' with food category | Simple approval, minimal data | |
| You decide | Claude picks | |

**User's choice:** Remaining allowance per category

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — show consumption history | Where guest consumed + timestamps | ✓ |
| No — just 'limit reached' | Simple rejection, no history | |
| You decide | Claude picks | |

**User's choice:** Yes — show consumption history

---

## Claude's Discretion

- Redis data structures for consumption tracking
- Token ID format for anonymous mode
- Food rules storage model in Convex
- Lua script implementation details
- Food scan endpoint error codes
- Consumption history depth/format

## Deferred Ideas

None — discussion stayed within phase scope
