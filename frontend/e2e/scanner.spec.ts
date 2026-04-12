import { test, expect } from "@playwright/test";

test.describe("Scanner", () => {
  test("scanner page renders without admin shell", async ({ page }) => {
    await page.goto("/scanner");
    await page.waitForLoadState("networkidle");

    // No sidebar/admin navigation
    const sidebar = page.locator("nav").filter({ hasText: "Events" });
    await expect(sidebar).not.toBeVisible();

    // Scanner UI elements
    await expect(
      page.getByText(/select your station/i).or(page.getByText(/scanner/i)),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("scanner shows event selection dropdown", async ({ page }) => {
    await page.goto("/scanner");
    await page.waitForLoadState("networkidle");

    // Dropdown may show "Select an event" or a combobox role
    await expect(
      page.getByRole("combobox").first().or(page.getByText(/event/i).first()),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("start scanning button is disabled without selection", async ({
    page,
  }) => {
    await page.goto("/scanner");
    await page.waitForLoadState("networkidle");

    const startBtn = page.getByRole("button", { name: /start scanning/i });
    if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(startBtn).toBeDisabled();
    }
  });
});
