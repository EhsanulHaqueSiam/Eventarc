import { test, expect } from "@playwright/test";

const GO_API = process.env.GO_API_URL ?? "http://localhost:8080";

test.describe("Go API Health", () => {
  test("health endpoint returns ok with connected services", async ({
    request,
  }) => {
    const resp = await request.get(`${GO_API}/api/v1/health`);
    expect(resp.ok()).toBe(true);

    const body = await resp.json();
    expect(body.status).toBe("ok");
    expect(body.redis).toBe("connected");
    expect(body.postgres).toBe("connected");
  });

  test("HMAC-protected endpoint rejects unsigned requests", async ({
    request,
  }) => {
    const resp = await request.post(`${GO_API}/api/v1/sync/event`, {
      data: { test: "data" },
    });
    expect(resp.status()).toBe(401);

    const body = await resp.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("SSE endpoint returns event-stream content type", async () => {
    const controller = new AbortController();
    const resp = await fetch(`${GO_API}/api/v1/events/test-event/live`, {
      signal: controller.signal,
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });

  test("session create returns 201 with token", async ({ request }) => {
    const resp = await request.post(`${GO_API}/api/v1/session`, {
      data: {
        eventId: "test-event",
        vendorTypeId: "vtype-1",
        vendorCategoryId: "vcat-1",
        stallId: "stall-1",
      },
    });

    expect(resp.status()).toBe(201);
    const body = await resp.json();
    expect(body.token).toBeDefined();
    expect(body.token.length).toBe(64);
  });

  test("session create rejects invalid input with 400", async ({ request }) => {
    const resp = await request.post(`${GO_API}/api/v1/session`, {
      data: {},
    });

    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toBeDefined();
  });

  test("scan endpoint rejects invalid QR payload", async ({ request }) => {
    const resp = await request.post(`${GO_API}/api/v1/scan/entry`, {
      data: { qr_payload: "invalid", stall_id: "stall-1" },
    });
    expect(resp.status()).toBe(400);

    const body = await resp.json();
    expect(body.error).toBeDefined();
  });
});
