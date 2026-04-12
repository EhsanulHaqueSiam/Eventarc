// Configuration matrix for all 6 supported event combinations.
// Each config defines seed data requirements and expected behavior.

export const CONFIGS = [
  {
    name: 'unified_guestlinked_presnt',
    qrStrategy: 'unified',
    foodMode: 'guest-linked',
    foodTiming: 'pre-sent',
    // Unified QR: same payload used for entry AND food
    entryPayloadKey: 'unified_payload',
    foodPayloadKey: 'unified_payload',
  },
  {
    name: 'unified_anonymous_presnt',
    qrStrategy: 'unified',
    foodMode: 'anonymous',
    foodTiming: 'pre-sent',
    entryPayloadKey: 'unified_payload',
    foodPayloadKey: 'unified_payload',
  },
  {
    name: 'separate_guestlinked_presnt',
    qrStrategy: 'separate',
    foodMode: 'guest-linked',
    foodTiming: 'pre-sent',
    entryPayloadKey: 'entry_payload',
    foodPayloadKey: 'food_payload',
  },
  {
    name: 'separate_guestlinked_postentry',
    qrStrategy: 'separate',
    foodMode: 'guest-linked',
    foodTiming: 'post-entry',
    entryPayloadKey: 'entry_payload',
    foodPayloadKey: 'food_payload',
  },
  {
    name: 'separate_anonymous_presnt',
    qrStrategy: 'separate',
    foodMode: 'anonymous',
    foodTiming: 'pre-sent',
    entryPayloadKey: 'entry_payload',
    foodPayloadKey: 'food_payload',
  },
  {
    name: 'separate_anonymous_postentry',
    qrStrategy: 'separate',
    foodMode: 'anonymous',
    foodTiming: 'post-entry',
    entryPayloadKey: 'entry_payload',
    foodPayloadKey: 'food_payload',
  },
];

// Thresholds applied to ALL scenarios
export const COMMON_THRESHOLDS = {
  http_req_failed: ['rate==0'],          // Zero HTTP errors
  http_req_duration: ['p(95)<200'],      // p95 < 200ms for entry
};

export const FOOD_THRESHOLDS = {
  http_req_duration: ['p(95)<300'],      // p95 < 300ms for food (Lua overhead)
};

export const MIXED_THRESHOLDS = {
  http_req_failed: ['rate==0'],
  http_req_duration: ['p(95)<250'],      // Blended p95 for mixed workload
};
