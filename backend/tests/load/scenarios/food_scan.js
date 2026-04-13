import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

export const foodSuccess = new Counter('food_success');
export const foodLimitReached = new Counter('food_limit_reached');
export const foodError = new Counter('food_error');
export const foodDuration = new Trend('food_duration');

const payloads = new SharedArray('food_payloads', function () {
  const configName = __ENV.CONFIG_NAME || 'unified_guestlinked_presnt';
  return JSON.parse(open(`../payloads_${configName}.json`));
});

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const FOOD_SESSION_TOKEN =
  __ENV.FOOD_SESSION_TOKEN || __ENV.SESSION_TOKEN || '';
const FOOD_STALLS = ['stall_fuchka_01', 'stall_fuchka_02', 'stall_coke_01'];

export const options = {
  scenarios: {
    food_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 },
        { duration: '10s', target: 5000 },
        { duration: '10s', target: 10000 },
        { duration: '30s', target: 10000 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<300'],
    food_error: ['count==0'],
  },
};

export default function () {
  const idx = __VU - 1;
  const payload = payloads[idx % payloads.length];
  const foodKey = __ENV.FOOD_KEY || 'food_payload';
  const stallId = FOOD_STALLS[idx % FOOD_STALLS.length];

  const headers = { 'Content-Type': 'application/json' };
  if (FOOD_SESSION_TOKEN) headers.Authorization = `Bearer ${FOOD_SESSION_TOKEN}`;

  const res = http.post(
    `${BASE_URL}/api/v1/scan/food`,
    JSON.stringify({
      qr_payload: payload[foodKey] || payload.unified_payload || payload.qr_payload,
      stall_id: stallId,
      device_id: `device_k6_food_${__VU}`,
      food_category_id: 'fuchka',
    }),
    {
      headers,
      timeout: '5s',
    },
  );

  foodDuration.add(res.timings.duration);

  check(res, {
    'food status is 200': (r) => r.status === 200,
    'food response has valid state': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'valid' || body.status === 'limit_reached';
      } catch (e) {
        return false;
      }
    },
  });

  if (res.status !== 200) {
    foodError.add(1);
    return;
  }
  try {
    const body = JSON.parse(res.body);
    if (body.status === 'valid') foodSuccess.add(1);
    else if (body.status === 'limit_reached') foodLimitReached.add(1);
    else foodError.add(1);
  } catch (e) {
    foodError.add(1);
  }
}
