import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const scanSuccess = new Counter('scan_success');
const scanDuplicate = new Counter('scan_duplicate');
const scanError = new Counter('scan_error');
const scanDuration = new Trend('scan_duration');

// Pre-generated QR payloads (one per VU, loaded from JSON file)
const payloads = new SharedArray('payloads', function () {
  return JSON.parse(open('./payloads.json'));
});

export const options = {
  scenarios: {
    // Scenario 1: Ramp up to 10K concurrent VUs
    concurrent_scans: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 },  // Warm up
        { duration: '10s', target: 5000 },  // Ramp to 5K
        { duration: '10s', target: 10000 }, // Full 10K
        { duration: '30s', target: 10000 }, // Sustain 10K for 30s
        { duration: '10s', target: 0 },     // Ramp down
      ],
    },
    // Scenario 2: Duplicate scan flood (same QR scanned repeatedly)
    duplicate_flood: {
      executor: 'constant-vus',
      vus: 100,
      duration: '20s',
      startTime: '70s', // Start after main scenario
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],            // Zero HTTP errors
    http_req_duration: ['p(95)<200'],        // p95 < 200ms
    scan_error: ['count==0'],                // Zero scan processing errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const ENTRY_SESSION_TOKEN = __ENV.ENTRY_SESSION_TOKEN || __ENV.SESSION_TOKEN || '';

export default function () {
  const idx = __VU - 1; // VU index (0-based)
  const payload = payloads[idx % payloads.length];

  const headers = { 'Content-Type': 'application/json' };
  if (ENTRY_SESSION_TOKEN) headers.Authorization = `Bearer ${ENTRY_SESSION_TOKEN}`;

  const res = http.post(
    `${BASE_URL}/api/v1/scan/entry`,
    JSON.stringify({
      qr_payload: payload.qr_payload,
      stall_id: payload.stall_id || 'stall_load_test',
      device_id: `device_k6_${__VU}`,
    }),
    {
      headers,
      timeout: '5s',
    },
  );

  scanDuration.add(res.timings.duration);

  check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'response has status field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'valid' || body.status === 'duplicate';
      } catch (e) {
        return false;
      }
    },
  });

  if (res.status === 200) scanSuccess.add(1);
  else if (res.status === 409) scanDuplicate.add(1);
  else scanError.add(1);
}

// Duplicate flood scenario function
export function duplicateFlood() {
  // Use the first payload repeatedly to test duplicate detection under load
  const payload = payloads[0];

  const headers = { 'Content-Type': 'application/json' };
  if (ENTRY_SESSION_TOKEN) headers.Authorization = `Bearer ${ENTRY_SESSION_TOKEN}`;

  const res = http.post(
    `${BASE_URL}/api/v1/scan/entry`,
    JSON.stringify({
      qr_payload: payload.qr_payload,
      stall_id: 'stall_dup_flood',
      device_id: `device_dup_${__VU}`,
    }),
    {
      headers,
      timeout: '5s',
    },
  );

  check(res, {
    'duplicate returns 200 or 409': (r) => r.status === 200 || r.status === 409,
  });

  if (res.status === 200) scanSuccess.add(1);
  else if (res.status === 409) scanDuplicate.add(1);
  else scanError.add(1);
}
