import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// Simulates 50 admin dashboard SSE connections during load test.
// Verifies SSE endpoint stays responsive under scan load.

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const EVENT_ID = __ENV.EVENT_ID || 'load_test_event';
const sseError = new Counter('sse_error');

export const options = {
  scenarios: {
    dashboard_clients: {
      executor: 'constant-vus',
      vus: 50,
      duration: '60s',
    },
  },
  thresholds: {
    sse_error: ['count==0'],
  },
};

export default function () {
  // SSE connections are long-lived. k6 doesn't natively support SSE,
  // so we simulate with periodic GET requests to the SSE endpoint.
  // Each request opens a connection, reads the first event, and closes.
  const res = http.get(`${BASE_URL}/api/v1/events/${EVENT_ID}/live`, {
    headers: { Accept: 'text/event-stream' },
    timeout: '10s',
  });

  check(res, {
    'SSE endpoint responds': (r) => r.status === 200,
    'Content-Type is event-stream': (r) =>
      r.headers['Content-Type'] &&
      r.headers['Content-Type'].includes('text/event-stream'),
  });

  if (res.status !== 200) sseError.add(1);
}
