import { test, expect } from "@playwright/test";

test.describe("Scanner", () => {
  test("central scanner shows event-specific link notice", async ({ page }) => {
    await page.goto("/scanner");
    await page.waitForLoadState("networkidle");

    // No sidebar/admin navigation
    const sidebar = page.locator("nav").filter({ hasText: "Events" });
    await expect(sidebar).not.toBeVisible();

    await expect(page.getByText(/use event-specific link/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/central scanner access is disabled/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("legacy /scanner/:eventId redirects to /:eventId/scanner", async ({
    page,
  }) => {
    await page.goto("/scanner/test-event-id");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/test-event-id\/scanner$/);
    await expect(page.getByText(/select your station/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
