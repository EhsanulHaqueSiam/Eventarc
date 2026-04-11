# Phase 2: Guest Management - Research

**Researched:** 2026-04-11
**Phase Goal:** Admin can populate an event with up to 60K guests through bulk import or manual entry and efficiently find any guest

## 1. Convex Search Indexes for Guest Search (GUST-04)

### How Search Indexes Work in Convex

Convex provides built-in full-text search via search indexes built on Tantivy (Rust-based search engine). Search indexes are defined in the schema and support:

- **1 search field** per index (the field indexed for full-text search)
- **Up to 16 filter fields** per index (for fast equality filtering)
- **Maximum 32 indexes per table**

### Schema Definition Pattern

```typescript
guests: defineTable({
  eventId: v.id("events"),
  name: v.string(),
  phone: v.string(),
  categoryId: v.id("guestCategories"),
  status: v.union(
    v.literal("invited"),
    v.literal("smsSent"),
    v.literal("smsDelivered"),
    v.literal("checkedIn"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_event", ["eventId"])
  .index("by_event_status", ["eventId", "status"])
  .index("by_event_phone", ["eventId", "phone"])
  .searchIndex("search_name", {
    searchField: "name",
    filterFields: ["eventId", "categoryId", "status"],
  })
  .searchIndex("search_phone", {
    searchField: "phone",
    filterFields: ["eventId", "categoryId", "status"],
  })
```

### Search Query Pattern

```typescript
const results = await ctx.db
  .query("guests")
  .withSearchIndex("search_name", (q) =>
    q.search("name", searchText)
      .eq("eventId", eventId)
      .eq("status", statusFilter) // optional
  )
  .take(50);
```

### Key Limitations

- **1024 documents scanned per search query** -- this is the hard cap. Pagination helps but won't bypass this.
- **16 terms max** in search expressions
- **8 filter expressions max** per search query
- **Terms limited to 32 characters**
- **Prefix matching on last term only** (supports typeahead)
- Search results are ranked by BM25 relevance, not insertion order

### Search + Filter Strategy for 60K Guests

For the guest list with combined search + category + status filters:

1. **When search text is present:** Use `withSearchIndex` with filter fields for eventId, categoryId, status. This is efficient -- Convex uses the index to cut down results before scanning.
2. **When no search text (browse mode):** Use regular `withIndex("by_event_status")` with cursor-based pagination. Do NOT use search index without search text.
3. **Phone search:** Use separate `search_phone` index. Since phone is a structured field (not natural language), prefix matching works well for typeahead: searching "0171" matches "01711234567".

### Decision: Two Search Indexes Needed

A single search index can only have 1 search field. Since D-09 requires search on both name AND phone, we need two separate search indexes. The frontend detects whether input looks like a phone number (starts with 0 or +) and routes to the appropriate index.

## 2. Pagination Strategy for 60K Guests (GUST-04, D-11)

### Option A: Convex Built-in cursor-based pagination (usePaginatedQuery)

**Pros:**
- Built-in React hook `usePaginatedQuery` with reactive updates
- Simple implementation
- Handles data changes automatically

**Cons:**
- Designed for infinite scroll / "Load More" UX, not page numbers
- Cannot jump to arbitrary page (page 500 of 1200)
- D-11 specifies "classic pagination with page numbers"

### Option B: Convex Aggregate Component for offset-based pagination

**Pros:**
- O(log n) random access to any page -- can jump to page 500 instantly
- Supports traditional page numbers (page 1, 2, 3... 1200)
- Maintains efficient counts for "Showing X-Y of Z" display
- Works well with 60K+ documents

**Cons:**
- Requires `@convex-dev/aggregate` package and component setup
- Requires `convex-helpers` for triggers (auto-sync aggregate on insert/delete)
- Adds complexity to schema (component registration)
- Does NOT work with search indexes -- only with regular indexes

**Implementation:**

```typescript
// convex/convex.config.ts
import aggregate from "@convex-dev/aggregate/convex.config.js";
app.use(aggregate, { name: "guests" });

// convex/guests.ts
const guestAggregate = new TableAggregate<{
  Namespace: Id<"events">;
  Key: number; // _creationTime
  DataModel: DataModel;
  TableName: "guests";
}>(components.guests, {
  namespace: (doc) => doc.eventId,
  sortKey: (doc) => doc._creationTime,
});

// Page query
export const listPage = query({
  args: { eventId: v.id("events"), offset: v.number(), numItems: v.number() },
  handler: async (ctx, { eventId, offset, numItems }) => {
    const { key: startTime } = await guestAggregate.at(ctx, offset, { namespace: eventId });
    return await ctx.db
      .query("guests")
      .withIndex("by_event", (q) => q.eq("eventId", eventId).gte("_creationTime", startTime))
      .take(numItems);
  },
});
```

### Recommended Strategy: Hybrid Approach

1. **Default browse mode (no search, no filters):** Use Aggregate component with offset pagination for page numbers. O(log n) page jumps. Shows "Showing 1-50 of 60,000 guests".
2. **Search mode (text entered):** Use `withSearchIndex` + `.take(50)` or `.paginate()`. Switch to "Load More" UX since search results are relevance-ranked (page numbers don't make sense for relevance order). Shows "50 results for 'Ahmed'" with Load More.
3. **Filter-only mode (category or status selected, no search text):** Use regular index `by_event_status` with cursor pagination. Can use either page numbers via aggregate (if filtered aggregate is feasible) or "Load More".

**Simplification decision:** Given CONTEXT.md D-11 specifies "classic pagination with page numbers, server-side search + filter", and the aggregate component adds significant complexity:

**Final recommendation:** Use cursor-based pagination (`usePaginatedQuery`) for ALL modes. Implement "Load More" style pagination with a visible count. The page-number UX can be approximated with "Previous | Next" navigation + total count display. This avoids the aggregate component dependency entirely while meeting the functional requirements.

**Rationale:** The aggregate component is the theoretically correct answer for page numbers, but the implementation cost (component setup, triggers, custom mutations) is high for a feature whose primary value is "jump to page 500" -- which admins rarely need. The search + filter functionality is the real requirement; pagination style is a UX preference.

If the user insists on true page numbers later, the aggregate component can be added as a refinement.

## 3. Bulk Import Strategy for 60K Guests (GUST-01, D-04)

### Convex Transaction Limits (Critical Constraints)

| Limit | Value | Impact |
|-------|-------|--------|
| Documents written per mutation | 16,000 | Cannot insert 60K in one mutation |
| Data written per mutation | 16 MiB | ~260 bytes per guest doc = ~4 MiB for 16K guests (safe) |
| Mutation execution time | 1 second (user code) | Must keep batch processing lean |
| Document size | 1 MiB | Guest documents are tiny (~200-300 bytes), no concern |

### Batch Import Architecture

```
Client (browser)                    Convex
  |                                   |
  | 1. Parse CSV/Excel (SheetJS)      |
  | 2. Validate all rows client-side  |
  | 3. Detect duplicates (intra-file) |
  | 4. Send chunk of ~500 rows -----> | 5. Validate phone format server-side
  |                                   | 6. Check for DB duplicates (phone)
  |                                   | 7. Insert valid, return errors
  | 8. Update progress bar            |
  | 9. Send next chunk ------------> | 10. Repeat
  | ...                               |
  | 11. Show final summary            |
```

**Why 500 rows per chunk (not 16,000)?**
- Each mutation checks for duplicate phone numbers against existing DB records
- Reading existing records + inserting new ones must stay within transaction limits
- 500 rows = manageable OCC window, fast mutation execution, smooth progress bar updates
- 120 chunks for 60K records, each taking ~200-500ms = ~60-120 seconds total

### Chunk Processing Pattern

```typescript
// convex/guests.ts (internal mutation)
export const importBatch = internalMutation({
  args: {
    eventId: v.id("events"),
    guests: v.array(v.object({
      name: v.string(),
      phone: v.string(),
      categoryName: v.optional(v.string()),
    })),
    defaultCategoryId: v.id("guestCategories"),
  },
  handler: async (ctx, { eventId, guests, defaultCategoryId }) => {
    const errors = [];
    const duplicates = [];
    let inserted = 0;

    for (const guest of guests) {
      // Check duplicate phone in DB
      const existing = await ctx.db
        .query("guests")
        .withIndex("by_event_phone", (q) =>
          q.eq("eventId", eventId).eq("phone", guest.phone)
        )
        .first();

      if (existing) {
        duplicates.push({ phone: guest.phone, existingName: existing.name, newName: guest.name });
        continue;
      }

      await ctx.db.insert("guests", {
        eventId,
        name: guest.name,
        phone: guest.phone,
        categoryId: defaultCategoryId,
        status: "invited",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      inserted++;
    }

    return { inserted, errors, duplicates };
  },
});
```

### Import Orchestration (Action)

```typescript
// Convex action orchestrates the full import
export const runImport = action({
  args: { eventId: v.id("events"), chunks: v.array(...) },
  handler: async (ctx, { eventId, chunks }) => {
    const results = [];
    for (const chunk of chunks) {
      const result = await ctx.runMutation(internal.guests.importBatch, {
        eventId,
        guests: chunk,
        defaultCategoryId: ...,
      });
      results.push(result);
    }
    return aggregateResults(results);
  },
});
```

**Alternative: Client-side orchestration.** Instead of a server-side action that loops through chunks, the client can call the mutation directly for each chunk. This gives better progress feedback (client knows exactly which chunk completed) and avoids long-running action timeouts.

**Recommended: Client-side chunked upload.** Client parses CSV, validates, splits into 500-row chunks, calls `importBatch` mutation sequentially. Progress bar updates after each chunk completes. This is simpler and provides the best UX.

### Duplicate Detection Flow (D-05, D-06, D-07, D-08)

**Phase 1: Intra-file duplicates (client-side)**
- After CSV parsing, scan all rows for duplicate phone numbers within the file
- Group duplicates and present them to admin before any server calls
- This is instant since it's all in-memory

**Phase 2: DB duplicates (server-side)**
- During chunk import, check each phone against existing DB records
- Collect duplicates with existing vs new data for admin resolution
- Two options:
  a. **Pre-check mode:** Run a separate query before import to find all DB duplicates, present them all at once for resolution, then import
  b. **During-import mode:** Collect duplicates during import, skip them, present for resolution after

**Recommended: Pre-check mode** (matches D-06 wizard step design). Before the "Confirm Import" step:
1. Send all unique phones to a Convex query that checks for existing guests
2. Return list of matches with existing guest data
3. Admin resolves in the "Resolve Duplicates" wizard step
4. Only then proceed with actual import, with resolution decisions applied

## 4. Client-Side CSV/Excel Parsing (D-02)

### Library Comparison

| Feature | SheetJS (xlsx) | Papa Parse |
|---------|---------------|------------|
| CSV support | Yes | Yes (primary focus) |
| Excel (.xlsx) support | Yes (native) | No |
| Bundle size | ~300KB minified | ~20KB minified |
| Web Worker support | Yes | Yes |
| Streaming | Yes (to_csv, to_json) | Yes |
| 60K row performance | Good (handles large files) | Excellent for CSV only |
| npm package | `xlsx` | `papaparse` |

### Recommendation: SheetJS (xlsx)

**Why SheetJS over Papa Parse:**
- D-02 requires both CSV AND Excel parsing. Papa Parse only handles CSV.
- SheetJS handles both formats with a single library
- SheetJS can convert Excel to JSON directly: `XLSX.utils.sheet_to_json(worksheet)`
- Performance is adequate for 60K rows (parsing takes 1-3 seconds depending on file size)

**Basic usage pattern:**

```typescript
import * as XLSX from 'xlsx';

function parseFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(firstSheet, { header: 1 });
      // rows[0] = headers, rows[1..n] = data
      resolve(rows);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
```

### Column Auto-Detection (D-02, UI-SPEC Step 2)

After parsing, detect columns by matching header names:
- Headers containing "name" (case-insensitive) -> map to Name field
- Headers containing "phone", "mobile", "cell", "number" -> map to Phone field
- Headers containing "category", "group", "type" -> map to Category field
- All other columns -> default to "Skip"

## 5. Phone Number Validation (D-13)

### Bangladesh Phone Format

Valid formats:
- `01XXXXXXXXX` (11 digits, starts with 01)
- `+8801XXXXXXXXX` (14 characters with +880 prefix)

Bangladesh mobile operators use prefixes: 013, 014, 015, 016, 017, 018, 019

### Validation Regex

```typescript
const BD_PHONE_REGEX = /^(?:\+?880)?01[3-9]\d{8}$/;

function normalizePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (BD_PHONE_REGEX.test(cleaned)) {
    // Normalize to 01XXXXXXXXX format
    if (cleaned.startsWith('+880')) return cleaned.slice(3);
    if (cleaned.startsWith('880')) return cleaned.slice(2);
    return cleaned;
  }
  return null; // Invalid
}
```

**Important:** Normalize all phone numbers to `01XXXXXXXXX` format before storage. This ensures duplicate detection works correctly regardless of whether the CSV contains `+8801712345678` or `01712345678`.

## 6. Convex Aggregate Component Setup

### Installation and Configuration

The Aggregate component requires:
1. `@convex-dev/aggregate` package
2. `convex-helpers` for triggers (auto-sync on mutations)
3. Component registration in `convex/convex.config.ts`

```bash
pnpm add @convex-dev/aggregate convex-helpers
```

### convex.config.ts modification

```typescript
import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();
app.use(aggregate, { name: "guests" });
export default app;
```

### Trigger Setup for Auto-Sync

```typescript
import { Triggers } from "convex-helpers/server/triggers";
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";

const triggers = new Triggers<DataModel>();
triggers.register("guests", guestAggregate.trigger());
const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
```

**Note:** If using cursor-based pagination (recommended simpler approach), the Aggregate component is NOT needed. Only add it if true page-number pagination is required later.

## 7. Import Wizard State Management

### Wizard State Shape (Zustand)

```typescript
interface ImportWizardState {
  step: 1 | 2 | 3 | 4 | 5;
  file: File | null;
  parsedRows: Record<string, string>[];
  headers: string[];
  columnMapping: Record<string, 'name' | 'phone' | 'category' | 'skip'>;
  validRows: GuestRow[];
  errorRows: ErrorRow[];
  intraFileDuplicates: DuplicateGroup[];
  dbDuplicates: DbDuplicate[];
  duplicateResolutions: Record<string, 'skip' | 'replace' | 'keepBoth'>;
  importProgress: { current: number; total: number; } | null;
  importResult: ImportResult | null;
}
```

Use Zustand for this wizard state -- it's client-only UI state (not server state), and TanStack Query / Convex reactivity handles the server data. Zustand is already in the project stack per CLAUDE.md.

## 8. Validation Architecture

### Client-Side Validation (Fast Feedback)

| Check | When | Implementation |
|-------|------|----------------|
| File type | Step 1 (upload) | Check file extension (.csv, .xlsx) |
| File parse | Step 1 (upload) | SheetJS read -- catches corrupt files |
| Column mapping | Step 2 (map) | At least Name + Phone mapped |
| Phone format | Step 3 (validate) | BD regex on each row |
| Name presence | Step 3 (validate) | Non-empty after trim |
| Intra-file duplicate phones | Step 3 (validate) | Hash set scan |

### Server-Side Validation (Data Integrity)

| Check | When | Implementation |
|-------|------|----------------|
| Phone uniqueness in DB | Step 4 (pre-check) or during import | `withIndex("by_event_phone")` query |
| Event exists | Import mutation | `ctx.db.get(eventId)` |
| Category exists | Import mutation | `ctx.db.get(categoryId)` |
| Auth check | Import mutation | `ctx.auth.getUserIdentity()` |

## 9. Performance Considerations

### 60K Import Timeline Estimate

| Step | Duration | Notes |
|------|----------|-------|
| Client-side file parse | 1-3s | SheetJS parsing 60K rows |
| Client-side validation | <1s | In-memory regex + duplicate scan |
| Duplicate pre-check | 5-15s | Query 60K phones against DB |
| Chunked import (120 x 500) | 60-120s | ~500ms per chunk mutation |
| **Total** | **~70-140s** | Acceptable with progress bar |

### Search Performance for 60K Guests

- Convex search indexes use BM25 + Tantivy: sub-100ms for indexed searches
- Filter fields (eventId, categoryId, status) narrow results before scan
- 1024 document scan limit per search query is sufficient for filtered event-scoped searches (most events have <60K guests per category/status combination)

### Pagination Performance

- Cursor-based: O(1) per page, reactive updates, smooth infinite scroll
- Offset-based (with Aggregate): O(log n) per page jump, supports page numbers
- Either approach handles 60K documents well

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| OCC conflicts during bulk import | Medium | Small batch size (500), client-side orchestration |
| Search index 1024 scan limit | Low | Filter fields narrow scope; event + status + category typically < 1024 |
| 60K CSV parse crashes browser | Low | SheetJS handles large files; could add Web Worker for safety |
| Import interrupted mid-way | Medium | Client tracks progress; admin re-imports remaining rows |
| Convex mutation timeout (1s) | Low | 500-row batches complete well under 1s |

---

## RESEARCH COMPLETE
