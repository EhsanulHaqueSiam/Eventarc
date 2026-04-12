import { test, expect } from "@playwright/test";

test.describe("Scanner (Mobile Viewport)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("scanner page is mobile-responsive", async ({ page }) => {
    await page.goto("/scanner");
    await page.waitForLoadState("networkidle");

    // Page should render without horizontal scroll
    const body = page.locator("body");
    const bodyWidth = await body.evaluate((el) => el.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance

    // Key elements visible on mobile
    await expect(
      page.getByText(/select your station/i).or(page.getByText(/scanner/i)),
    ).toBeVisible();
  });
});
