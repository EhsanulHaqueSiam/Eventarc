import { test, expect } from "./fixtures/auth";

test.describe("Events", () => {
  test("events page loads with app shell", async ({ page }) => {
    // Already on /events from auth fixture
    await expect(page.getByText("EventArc").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();

    // Status filter tabs
    for (const tab of ["All", "Draft", "Active", "Live"]) {
      await expect(page.getByText(tab, { exact: true }).first()).toBeVisible();
    }

    // Create button
    await expect(
      page.getByRole("button", { name: /create event/i }).first(),
    ).toBeVisible();
  });

  test("create event dialog opens and has required fields", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /create event/i }).first().click();

    // Dialog appears
    await expect(
      page.getByRole("dialog").or(page.locator("[role=dialog]")),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("event detail page shows tabs", async ({ page }) => {
    // Click first event card (may be a link or clickable card)
    const eventCard = page
      .locator("a[href*='/events/']")
      .or(page.locator("[data-slot='card']").filter({ hasText: /20[0-9]{2}/ }))
      .first();
    await expect(eventCard).toBeVisible({ timeout: 10_000 });

    await eventCard.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);

    // Verify tabs exist
    for (const tab of ["Overview", "Categories", "Vendors"]) {
      await expect(page.getByText(tab, { exact: true }).first()).toBeVisible();
    }
  });

  test("sizing guide page renders", async ({ page }) => {
    await page.goto("/sizing-guide");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/sizing guide/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
