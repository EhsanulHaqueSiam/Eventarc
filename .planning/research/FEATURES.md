# Feature Research

**Domain:** Large-scale private event management with QR-based access control and food distribution tracking
**Researched:** 2026-04-11
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features the admin expects from day one. Missing any of these makes the system unusable for its core purpose.

#### Guest Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CSV/Excel bulk guest import | 60K guests cannot be added manually. Every event platform (RSVPify, Diobox, Guest Manager, EventNook) supports CSV import as baseline. | MEDIUM | Must handle: column mapping, validation errors per row, progress indication for large files. Excel parsing adds complexity (multiple sheets, date formats). |
| Manual guest entry | Quick additions, walk-ins, last-minute VIPs. Standard in every platform. | LOW | Simple form. Must coexist with bulk import without duplication. |
| Guest deduplication | Duplicate entries from re-imports or multiple sources corrupt scan data. A duplicate guest = two QR codes = double food access. | MEDIUM | Match on phone number (primary identifier for SMS-based system). Flag duplicates for admin resolution rather than auto-merging. |
| Guest search and filtering | Admin needs to find specific guests among 60K. Every platform provides instant search. | LOW | Search by name, phone, category. Must be fast -- index on searchable fields. |
| Guest categories/tiers | Different guests get different privileges (VIP areas, food allocations). Standard in RSVPify, Diobox, CrowdPass, VOW. Explicitly required in PROJECT.md. | MEDIUM | Admin-configurable per event. Categories drive food rules and access levels. |
| Guest status tracking | Admin must know: invited, SMS sent, SMS delivered, checked in, not arrived. Every platform tracks guest lifecycle. | LOW | State machine per guest per event. |

#### QR Code System

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Unique QR per guest for entry | 1:1 guest-to-QR mapping is the foundation. Every access control platform (CrowdPass, fielddrive, Diobox) does this. Core requirement in PROJECT.md. | MEDIUM | Pre-generate all QR images. Store in object storage (S3/R2). Encode guest ID + event ID + HMAC signature to prevent forgery. |
| QR scan validation with instant response | Scan must return valid/invalid within sub-second. Standard in all QR check-in platforms. | HIGH | Hot path: CDN-cached QR data -> Redis lookup -> atomic status update. Must handle 10K concurrent scans. |
| Duplicate scan prevention | One QR = one entry. Every platform locks QR after first scan. A second scan of the same QR must show "already checked in" with timestamp. | MEDIUM | Idempotent scan operations. Redis-backed atomic check-and-set. Must work correctly even under concurrent attempts on same QR. |
| Configurable QR strategy per event | Some events want one QR for everything; others want separate entry and food QRs. Explicitly required in PROJECT.md. | MEDIUM | Event-level configuration flag. Affects QR generation pipeline and scan validation logic. |
| Food QR with configurable mode | Guest-linked (per-person limits) vs anonymous (volume tracking). Explicitly required in PROJECT.md. | HIGH | Two distinct validation paths. Guest-linked requires checking consumption limits per guest per food category. Anonymous requires only token validity. |

#### Invitation System

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bulk SMS delivery | Primary delivery channel (not email). 60K SMS messages require a bulk SMS API (BulkSMS.net or equivalent). | MEDIUM | Rate limiting, delivery status tracking, retry logic for failures. Must handle provider throttling gracefully. SMS has 98% open rate vs ~20% for email. |
| SMS delivery status tracking | Admin must know which invitations were delivered vs failed. Standard in SMS platforms (Messente, SimpleTexting, TextMagic). | LOW | Webhook-based status updates from SMS provider. Track: queued, sent, delivered, failed, undeliverable. |
| Invitation card with QR code | The QR must be embedded in a visual invitation card, not sent as a raw QR image. This is the admin's expected workflow per PROJECT.md. | HIGH | Image composition pipeline: base card design + QR overlay -> composite image -> store in object storage -> link in SMS. Must handle 60K image generations. |

#### Vendor Scanning Interface

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| No-auth device-based scanning | Vendor staff are temporary workers for 1-4 day events. No login/password. Open link, pick stall, scan. Explicitly required in PROJECT.md. | MEDIUM | Device-based session tokens. No credentials. Admin can revoke device sessions. |
| Stall selection dropdown | Vendor opens the scanning page, picks their stall from a list. Scans are attributed to that stall. | LOW | Simple UI: event -> vendor type -> category -> stall. Persisted in device session. |
| Scan result feedback | Immediate visual/audio feedback: green (valid), red (invalid/already used), with reason text. Standard UX in all scanning platforms. | LOW | Large, clear visual indicators. Sound feedback. Must work in noisy outdoor environments. |
| Camera-based QR scanning | Use device camera to scan QR codes. No external hardware required. Standard in Diobox, CrowdPass, RSVPify check-in apps. | MEDIUM | Web-based camera access (getUserMedia API). Must work across mobile browsers. Library: jsQR or html5-qrcode. |

#### Admin Dashboard

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real-time attendance counter | Live count of checked-in guests. Every event platform shows this. Explicitly required in PROJECT.md. | HIGH | Atomic counters (not COUNT queries). SSE/WebSocket push to dashboard. Must reflect scans within seconds. |
| Event overview with key metrics | Total guests, checked in, pending, food consumption totals. Standard in EventsAir, Swapcard, fielddrive dashboards. | MEDIUM | Aggregate multiple atomic counters into a single dashboard view. |
| Multi-event management | Admin manages multiple events over time. Standard in every platform. Explicitly required in PROJECT.md. | MEDIUM | Event CRUD, event lifecycle (draft -> active -> live -> completed -> archived). |

#### Data Integrity & Reliability

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Offline scan queuing | Network drops at venues are expected. Scanning must continue. Diobox, fielddrive, and others support offline mode. Explicitly required in PROJECT.md. | HIGH | Service Worker or local storage queue. Idempotent sync on reconnection. Must prevent duplicate processing. This is the hardest reliability feature. |
| Concurrent write handling | 10K simultaneous scans without race conditions. Core requirement in PROJECT.md. | HIGH | Redis atomic operations (SETNX, Lua scripts). Database-level optimistic locking as fallback. Load-tested paths. |

---

### Differentiators (Competitive Advantage)

Features that go beyond what standard platforms offer. These are where EventArc provides unique value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Visual invitation card editor | Admin uploads design, drag-drop QR placement, resize, preview. Most platforms offer email templates, not custom card image composition. CardMakerz is the closest parallel but it's a generic design tool, not integrated into an event flow. | HIGH | Canvas-based editor (Fabric.js or Konva.js). QR position/size saved as metadata. Batch rendering pipeline generates 60K composite images. This is a major differentiator. |
| Food distribution tracking per vendor stall | Track consumption across vendor stalls with per-category limits. No mainstream event platform does this -- they track entry, not food distribution at this granularity. GoTab and food hall POS systems are the closest analog but they involve payment, not allocation tracking. | HIGH | Vendor type -> category -> stall hierarchy. Per-guest consumption counters. Cross-stall rules ("one fuchka regardless of stall"). Real-time consumption analytics. |
| Admin-configurable food rules | "One fuchka per guest regardless of stall", "unlimited biryani", "2 drinks total". No competitor offers this level of food allocation configuration. | MEDIUM | Rule engine: per-category limits, per-guest limits, cross-stall enforcement. Rules evaluated at scan time against guest consumption history. |
| Food QR timing configuration | Pre-sent with invitation vs generated after entry scan. Allows events to control when food access is granted. | MEDIUM | Conditional QR generation pipeline. If post-entry: trigger food QR generation on entry scan event, then deliver (SMS or display). |
| Real-time food consumption dashboard | Live metrics per stall: items served, rate per minute, busiest stalls, consumption by category. No event platform offers this. Restaurant analytics (Toast, GoodData) are the closest parallel. | HIGH | Atomic counters per stall per category. SSE-pushed dashboard. Heatmap of vendor activity. Consumption rate calculations. |
| Vendor hierarchy management | Vendor types -> categories -> stalls (e.g., food -> fuchka -> fuchka-1, fuchka-2). Structured vendor organization with independent scanning stations per stall. | MEDIUM | Tree-structured vendor configuration. Each stall is an independent scan point. Aggregation up the hierarchy for reporting. |
| Guest-linked consumption history | "Guest X had 1 fuchka, 1 biryani, 0 drinks" -- full per-guest food consumption log. Useful for post-event analysis and rule enforcement. | MEDIUM | Append-only scan log per guest. Queryable for both rule enforcement (at scan time) and analytics (post-event). |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features to deliberately NOT build for v1. Scope killers.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Payment processing at stalls | "Vendors want to sell extras" | Adds PCI compliance, payment gateway integration, refund handling, settlement logic. Completely different domain. Food is free/included at these events. Explicitly out of scope in PROJECT.md. | Track consumption only. If payment needed later, integrate with external POS. |
| Native mobile app for scanning | "Native apps scan faster" | Two separate codebases (iOS + Android) or React Native complexity. Web-based camera scanning via getUserMedia is fast enough. Diobox and RSVPify both offer web-based scanning. | Progressive Web App (PWA) with camera access. Add to homescreen for app-like experience. Offline support via Service Worker. |
| Multi-admin roles (super admin, event manager, viewer) | "We need role-based access" | RBAC adds significant complexity: permission matrices, role assignment UI, audit trails per role. Single admin per event is sufficient for v1 per PROJECT.md. | Single admin per event for v1. Add role hierarchy in v2 if needed. |
| Guest self-registration / public RSVP | "Let guests sign up themselves" | This is a private event system. Admins control the guest list. Self-registration opens the door to unauthorized access and defeats the purpose of QR-controlled entry. Explicitly out of scope. | Admin imports all guests. No public-facing registration. |
| Seating management / table assignments | "We need seating charts" | Major UI complexity (drag-drop seating editor, table capacity management, guest reassignment). Not related to the core value of QR-based access and food tracking. | Out of scope entirely. Different product domain. |
| Email invitations alongside SMS | "Some guests prefer email" | Dual delivery channels double the template management, tracking, and delivery infrastructure. SMS is the primary channel and has 98% open rates. | SMS only for v1. Email can be added in v2 as secondary channel. |
| Video/livestream integration | "Stream the event online" | Completely different infrastructure (CDN for video, WebRTC, encoding). Not an event broadcasting platform. Explicitly out of scope. | Out of scope. Use dedicated streaming platforms if needed. |
| Multi-language support | "Our guests speak different languages" | i18n across all UI surfaces (admin, vendor scanning, invitation cards, SMS messages) is pervasive complexity. | English-only for v1. Internationalize in v2 if demand is proven. |
| Real-time chat/messaging with guests | "Notify guests during event" | Two-way messaging requires persistent connections per guest, message queuing, read receipts. Massive infrastructure for marginal value. | One-way SMS blast for event-day announcements if needed. Not a chat system. |
| Badge/wristband printing | "Print badges at check-in" | Requires printer hardware integration, badge template designer, print queue management. | QR on phone screen is the credential. No physical badge needed. |

---

## Feature Dependencies

```
[CSV/Excel Bulk Import]
    |
    v
[Guest Deduplication] ---> [Guest Categories/Tiers]
                                |
                                v
                     [QR Code Generation] ---> [QR Strategy Config (unified vs separate)]
                          |         |
                          v         v
              [Entry QR System]   [Food QR System]
                   |                    |
                   v                    v
          [Entry Scan Validation]  [Food Scan Validation]
                   |                    |
                   |                    v
                   |           [Food Rules Engine]
                   |                    |
                   v                    v
         [Attendance Counter]    [Consumption Counter]
                   \                  /
                    v                v
              [Real-Time Admin Dashboard (SSE)]
                         |
                         v
              [Post-Event Analytics & Export]

[Invitation Card Editor]
    |
    v
[Batch Image Composition Pipeline] ---> [Cloud Storage (S3/R2)]
    |                                          |
    v                                          v
[Bulk SMS Delivery] <---- [CDN for card image delivery]

[Vendor Hierarchy Config]
    |
    v
[Stall Selection UI] ---> [Device-Based Session]
    |
    v
[Camera QR Scanning] ---> [Scan Validation (entry or food)]

[Offline Scan Queue]
    |
    v
[Idempotent Sync] ---> [Scan Validation]
```

### Dependency Notes

- **Guest Import requires Guest Categories:** Categories must be defined before import so CSV rows can be assigned to categories during import.
- **QR Generation requires Guest Records:** QR codes are generated per guest -- guests must exist first.
- **Food Rules Engine requires Guest Categories:** Rules are configured per category (e.g., "VIP gets unlimited food, Regular gets 1 per category").
- **Invitation Card Editor requires QR Generation:** Cards composite QR images onto the design -- QRs must be generated first.
- **Bulk SMS requires Card Image Pipeline:** SMS includes the download link to the composed invitation card image.
- **Real-Time Dashboard requires Atomic Counters:** Dashboard reads counters, not aggregated queries. Counters must be incremented by scan validation.
- **Offline Sync requires Idempotent Scan Operations:** Re-synced scans must not double-count. Scan operations must be idempotent by design.
- **Food Scan Validation requires Vendor Hierarchy:** Scans are attributed to a specific stall within a category within a vendor type.

---

## MVP Definition

### Launch With (v1)

Minimum viable system that can run a single large-scale private event end-to-end.

- [ ] **Multi-event CRUD** -- Admin creates and configures events with basic settings
- [ ] **Guest bulk import (CSV)** -- Upload 60K guests with category assignment and deduplication
- [ ] **Guest categories** -- Admin-defined tiers with different food/access privileges per event
- [ ] **QR code generation pipeline** -- Pre-generate unique QR images, store in cloud storage, serve via CDN
- [ ] **Configurable QR strategy** -- Unified (one QR for entry + food) or separate QRs per event
- [ ] **Entry scan validation** -- Atomic, idempotent check-in with duplicate prevention at 10K concurrency
- [ ] **Food scan validation** -- Guest-linked mode (per-person limits) and anonymous mode (volume tracking)
- [ ] **Admin-configurable food rules** -- Per-category limits, cross-stall enforcement
- [ ] **Vendor hierarchy management** -- Vendor types -> categories -> stalls configuration
- [ ] **Device-based vendor scanning** -- No-auth scanning interface with stall selection and camera QR scanning
- [ ] **Scan result feedback** -- Clear visual/audio valid/invalid indication with reason text
- [ ] **Offline scan queuing with idempotent sync** -- Local queue during network drops, reliable sync on reconnection
- [ ] **Invitation card editor** -- Upload design, position/resize QR overlay, preview
- [ ] **Batch image composition** -- Generate 60K composite card images and store in cloud storage
- [ ] **Bulk SMS delivery** -- Send invitation SMS with card download link, track delivery status
- [ ] **Real-time admin dashboard** -- Live attendance count, food consumption by stall, vendor activity via SSE
- [ ] **Atomic counter system** -- No COUNT(*) queries; all real-time metrics via atomic counters

### Add After Validation (v1.x)

Features to add once the core system has proven itself at one real event.

- [ ] **Post-event analytics and reporting** -- Detailed consumption reports, peak time analysis, vendor performance comparison, exportable CSV/PDF
- [ ] **Event templates** -- Clone configuration from previous events to speed up setup for recurring events
- [ ] **SMS retry and fallback** -- Automatic retry for failed SMS deliveries with configurable retry policies
- [ ] **Guest activity timeline** -- Per-guest audit trail: when invited, when they entered, what they consumed, at which stalls
- [ ] **Dashboard alerts** -- Admin notifications for anomalies: stall going offline, unusually high consumption rate, capacity thresholds reached
- [ ] **Walk-in guest handling** -- Quick-add interface at entry gates for unregistered guests with immediate QR generation
- [ ] **Vendor analytics** -- Per-stall performance metrics: scans per hour, peak times, comparison across stalls in same category
- [ ] **QR code regeneration** -- Invalidate and regenerate QR for a guest (lost phone, compromised code)

### Future Consideration (v2+)

Features to defer until the product is proven and demand is clear.

- [ ] **Multi-admin roles** -- Role-based access (super admin, event manager, viewer) with permission matrices
- [ ] **Email invitation channel** -- Secondary delivery alongside SMS
- [ ] **Guest self-check-in kiosks** -- Dedicated kiosk mode for self-service entry (not vendor scanning)
- [ ] **Multi-language support** -- i18n for admin, vendor, and guest-facing interfaces
- [ ] **API for third-party integrations** -- Webhook and REST API for external systems to consume event data
- [ ] **White-labeling** -- Custom branding for the platform itself (not just invitation cards)
- [ ] **Mobile native apps** -- Dedicated iOS/Android scanning apps for environments where web camera access is insufficient

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Guest bulk import (CSV) | HIGH | MEDIUM | P1 |
| Guest categories/tiers | HIGH | MEDIUM | P1 |
| QR code generation pipeline | HIGH | MEDIUM | P1 |
| Entry scan validation (10K concurrent) | HIGH | HIGH | P1 |
| Food scan validation (dual mode) | HIGH | HIGH | P1 |
| Food rules engine | HIGH | MEDIUM | P1 |
| Vendor hierarchy management | HIGH | MEDIUM | P1 |
| Device-based vendor scanning | HIGH | MEDIUM | P1 |
| Offline scan queuing + sync | HIGH | HIGH | P1 |
| Real-time dashboard (SSE) | HIGH | HIGH | P1 |
| Atomic counter system | HIGH | MEDIUM | P1 |
| Invitation card editor | MEDIUM | HIGH | P1 |
| Batch image composition | MEDIUM | HIGH | P1 |
| Bulk SMS delivery | HIGH | MEDIUM | P1 |
| Guest deduplication | MEDIUM | MEDIUM | P1 |
| Post-event analytics/export | MEDIUM | MEDIUM | P2 |
| Event templates (clone) | MEDIUM | LOW | P2 |
| Walk-in guest handling | MEDIUM | LOW | P2 |
| Dashboard alerts | MEDIUM | MEDIUM | P2 |
| QR code regeneration | LOW | LOW | P2 |
| Guest activity timeline | LOW | MEDIUM | P2 |
| Vendor analytics | MEDIUM | MEDIUM | P2 |
| Multi-admin roles | LOW | HIGH | P3 |
| Email invitations | LOW | MEDIUM | P3 |
| Multi-language support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- system is non-functional without it
- P2: Should have, add after first successful event
- P3: Nice to have, future consideration based on demand

---

## Competitor Feature Analysis

| Feature | Diobox | RSVPify | CrowdPass | EventArc (Our Approach) |
|---------|--------|---------|-----------|------------------------|
| Guest import (CSV) | Yes, with mapping | Yes, with tagging | Yes | Yes, with validation + deduplication + category assignment |
| Guest categories | Tags and groups | Invite codes + groups | Zone-based groups | Admin-defined categories with food rule linkage |
| QR check-in | App-based, offline support | App-based, real-time sync | Badge + QR scanning | Web-based, device camera, offline queue, 10K concurrent |
| Duplicate scan prevention | Yes | Yes | Yes | Yes, atomic Redis-backed with idempotent operations |
| Food/consumption tracking | No | No | No | Core differentiator: per-stall, per-guest, per-category with configurable limits |
| Vendor scanning stations | No | No | No | Device-based, no-auth, stall-attributed scanning |
| Invitation cards with QR | Email templates only | Email with QR | Email with QR + Apple Wallet | Visual card editor with drag-drop QR placement, batch image generation |
| SMS invitations | No (email only) | No (email only) | No (email only) | Primary channel, bulk delivery, delivery tracking |
| Real-time dashboard | Basic check-in stats | Real-time attendee list | Attendance data | Live atomic counters: attendance + food consumption + vendor activity via SSE |
| Food rules configuration | N/A | N/A | N/A | Per-category limits, cross-stall enforcement, guest-linked vs anonymous modes |
| Offline scanning | Yes (iOS app) | Limited | Unknown | PWA with Service Worker queue, idempotent sync |
| Scale | Medium events | Medium-large events | Large events | Designed for 60K guests, 10K concurrent scans |

**Key insight:** No existing platform combines QR-based entry control with food distribution tracking at vendor stalls. This is genuinely unserved territory. The closest analogs are food hall POS systems (GoTab, Tabski) which handle ordering and payment, not allocation tracking. EventArc's food tracking system has no direct competitor.

---

## Sources

- [CrowdPass Access Control](https://www.crowdpass.co/access-control) -- Zone-based access, QR scanning features
- [Diobox Event Platform](https://home.d.io/) -- Guest management, QR check-in, invitation system
- [RSVPify Private Events](https://rsvpify.com/private-events/) -- Private invitation management, security layers
- [fielddrive QR Check-In Systems](https://www.fielddrive.com/blog/qr-check-in-systems-speedy-entry-visitor-management) -- Scanning throughput, hardware considerations
- [fielddrive Real-Time Dashboards](https://www.fielddrive.com/blog/real-time-analytics-dashboards-empowering) -- Event analytics patterns
- [GoTab Food Hall QR](https://gotab.com/business-type/food-hall-pos) -- Multi-vendor food ordering via QR
- [Tabski Food Hall Vendor Management](https://tabski.com/food-hall-vendor-management/) -- Vendor hierarchy, performance tracking
- [QRTRAC Music Festival QR Codes](https://qrtrac.com/solutions/multi-location-coupon-qr-codes/music-festival-qr-codes/) -- Per-person redemption limits across vendors
- [Coupon Carrier Event Distribution](https://www.couponcarrier.io/blog/how-to-distribute-qr-code-coupons/) -- Unique code distribution with scan limits
- [QRCodeChimp Ticket Fraud Prevention](https://www.qrcodechimp.com/qr-codes-for-event-tickets-with-validation-app/) -- Duplicate scan prevention, lock-after-scan
- [Godreamcast Duplicate Entry Prevention](https://godreamcast.com/blog/solution/in-person-event/prevent-duplicate-event-entry-ticket-fraud/) -- Real-time validation, fraud flags
- [Messente SMS Invitations](https://messente.com/blog/text-message-invitations) -- SMS invitation best practices, compliance
- [SimpleTexting Event Invitations](https://simpletexting.com/blog/how-to-send-text-message-invitations/) -- SMS scheduling, personalization
- [CardMakerz QR Card Design](https://cardmakerz.com/how-to-add-qr-codes-in-your-invitation-with-cardmakerz-com/) -- Visual QR placement on invitation cards
- [VOW Guest Management](https://www.vow.app/) -- VIP access levels, guest categorization
- [Ticket Fairy Event Wi-Fi](https://www.ticketfairy.com/blog/event-wi-fi-networking-in-2026-building-a-reliable-infrastructure-for-seamless-connectivity) -- Large-scale event infrastructure challenges
- [SSE vs WebSocket Comparison](https://websocket.org/comparisons/sse/) -- Real-time protocol selection for dashboards

---
*Feature research for: Large-scale private event management with QR-based access control and food distribution*
*Researched: 2026-04-11*
