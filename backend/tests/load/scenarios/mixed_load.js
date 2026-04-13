import http from 'k6/http';
import { check, group } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Mixed scenario: 70% entry scans, 30% food scans (realistic event distribution)
// Entry scans dominate early (arrival), food scans increase during event

const payloads = new SharedArray('mixed_payloads', function () {
  const configName = __ENV.CONFIG_NAME || 'unified_guestlinked_presnt';
  return JSON.parse(open(`../payloads_${configName}.json`));
});

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const ENTRY_SESSION_TOKEN = __ENV.ENTRY_SESSION_TOKEN || __ENV.SESSION_TOKEN || '';
const FOOD_SESSION_TOKEN =
  __ENV.FOOD_SESSION_TOKEN || __ENV.SESSION_TOKEN || ENTRY_SESSION_TOKEN;
const mixError = new Counter('mix_error');

export const options = {
  scenarios: {
    mixed_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 },
        { duration: '10s', target: 5000 },
        { duration: '10s', target: 10000 },
        { duration: '30s', target: 10000 }, // Sustain 10K for 30s
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<250'], // Blended p95 for mixed workload
    mix_error: ['count==0'],
  },
};

export default function () {
  const idx = __VU - 1;
  const payload = payloads[idx % payloads.length];
  const entryKey = __ENV.ENTRY_KEY || 'entry_payload';
  const foodKey = __ENV.FOOD_KEY || 'food_payload';
  const isEntryRequest = Math.random() < 0.7; // 70% entry, 30% food

  const entryHeaders = { 'Content-Type': 'application/json' };
  const foodHeaders = { 'Content-Type': 'application/json' };
  if (ENTRY_SESSION_TOKEN) entryHeaders.Authorization = `Bearer ${ENTRY_SESSION_TOKEN}`;
  if (FOOD_SESSION_TOKEN) foodHeaders.Authorization = `Bearer ${FOOD_SESSION_TOKEN}`;

  if (isEntryRequest) {
    group('entry_scan', function () {
      const res = http.post(
        `${BASE_URL}/api/v1/scan/entry`,
        JSON.stringify({
          qr_payload: payload[entryKey] || payload.unified_payload || payload.qr_payload,
          stall_id: 'stall_entry_01',
          device_id: `device_k6_mix_${__VU}`,
        }),
        {
          headers: entryHeaders,
          timeout: '5s',
        },
      );
      if (res.status !== 200 && res.status !== 409) mixError.add(1);
    });
  } else {
    group('food_scan', function () {
      const res = http.post(
        `${BASE_URL}/api/v1/scan/food`,
        JSON.stringify({
          qr_payload: payload[foodKey] || payload.unified_payload || payload.qr_payload,
          stall_id: 'stall_fuchka_01',
          device_id: `device_k6_mix_${__VU}`,
          food_category_id: 'fuchka',
        }),
        {
          headers: foodHeaders,
          timeout: '5s',
        },
      );
      if (res.status !== 200) {
        mixError.add(1);
        return;
      }
      try {
        const body = JSON.parse(res.body);
        if (body.status !== 'valid' && body.status !== 'limit_reached') {
          mixError.add(1);
        }
      } catch (e) {
        mixError.add(1);
      }
    });
  }
}
