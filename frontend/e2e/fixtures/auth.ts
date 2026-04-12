import { test as base, expect } from "@playwright/test";

const CONVEX_SITE_URL = process.env.VITE_CONVEX_SITE_URL;
if (!CONVEX_SITE_URL) {
  throw new Error(
    "VITE_CONVEX_SITE_URL is required for E2E tests. " +
      "Set it to your test deployment URL (e.g. VITE_CONVEX_SITE_URL=https://your-test-deploy.convex.site).",
  );
}

const TEST_USER = {
  email: process.env.E2E_TEST_EMAIL ?? "e2e@eventarc.test",
  password: process.env.E2E_TEST_PASSWORD ?? "E2eTest1234!",
  name: "E2E Test User",
};

let userEnsured = false;

async function ensureUserExists() {
  if (userEnsured) return;
  try {
    const resp = await fetch(`${CONVEX_SITE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: process.env.E2E_ORIGIN ?? "http://localhost:5173",
      },
      body: JSON.stringify(TEST_USER),
    });
    // 200 = created, 409/422 = already exists — both are acceptable
    if (!resp.ok && resp.status !== 409 && resp.status !== 422) {
      const body = await resp.text().catch(() => "(could not read body)");
      throw new Error(
        `Failed to ensure test user exists: ${resp.status} ${resp.statusText}\n${body}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Failed to ensure")) {
      throw error;
    }
    throw new Error(
      `Cannot reach Convex site URL (${CONVEX_SITE_URL}). Is the deployment running?\n${error}`,
    );
  }
  userEnsured = true;
}

/**
 * Test fixture that authenticates via the real UI login flow.
 * Each test gets a fresh login — uses Playwright's fill() which
 * works with React controlled inputs.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await ensureUserExists();

    // Login via UI
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Email").fill(TEST_USER.email);
    await page.getByPlaceholder("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/events", { timeout: 15_000 });

    await use(page);
  },
});

export { expect };
