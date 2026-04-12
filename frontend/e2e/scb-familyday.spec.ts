import { test, expect } from "./fixtures/auth";
import {
  navigateToEvent,
  addCategory,
  addCategoryWithStalls,
} from "./fixtures/helpers";

test.describe("SCB Family Day - Full Event Setup", () => {
  test.describe.configure({ mode: "serial" });

  let eventUrl: string;

  test("create SCB Family Day event", async ({ page }) => {
    await page.getByRole("button", { name: /create event/i }).first().click();

    await expect(page.getByText("Create Event").nth(1)).toBeVisible({
      timeout: 5_000,
    });

    await page.getByPlaceholder("Event name").fill("SCB Family Day 2026");
    await page
      .locator("input[type='datetime-local']")
      .fill("2026-07-15T09:00");
    await page
      .getByPlaceholder("Venue name")
      .fill("SCB Convention Hall, Dhaka");
    await page
      .getByPlaceholder("Event description")
      .fill(
        "Annual family day event for SCB employees with food stalls, entry gates, and entertainment",
      );

    const separateBtn = page
      .getByRole("radio", { name: "Separate" })
      .or(page.locator("button").filter({ hasText: "Separate" }));
    if (await separateBtn.isVisible().catch(() => false)) {
      await separateBtn.click();
    }

    const submitBtn = page
      .locator("button")
      .filter({ hasText: /^Create Event$/ })
      .last();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    await expect(
      page.getByRole("heading", { name: "SCB Family Day 2026" }),
    ).toBeVisible({ timeout: 10_000 });
    eventUrl = page.url();

    await expect(page.getByText("draft").first()).toBeVisible();
  });

  test("add guest categories: VIP, Employee, Family", async ({ page }) => {
    await navigateToEvent(page, eventUrl, "SCB Family Day");

    await page.getByText("Categories", { exact: true }).first().click();
    await expect(page.getByText("General").first()).toBeVisible();

    for (const name of ["VIP", "Employee", "Family"]) {
      await addCategory(page, name);
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });

  test("add entry vendor categories with stalls", async ({ page }) => {
    await navigateToEvent(page, eventUrl, "SCB Family Day");

    await page.getByText("Vendors", { exact: true }).first().click();
    await page.waitForTimeout(500);

    await addCategoryWithStalls(page, "entry", "Main Gate", [
      "Gate A",
      "Gate B",
    ]);
    await expect(page.getByText("Main Gate").first()).toBeVisible();

    await addCategoryWithStalls(page, "entry", "VIP Entrance", ["VIP Gate"]);
    await expect(page.getByText("VIP Entrance").first()).toBeVisible();
  });

  test("add food vendor categories with multiple stalls", async ({ page }) => {
    await navigateToEvent(page, eventUrl, "SCB Family Day");

    await page.getByText("Vendors", { exact: true }).first().click();
    await page.waitForTimeout(500);

    await addCategoryWithStalls(page, "food", "Biryani", [
      "Biryani Stall 1",
      "Biryani Stall 2",
    ]);

    await addCategoryWithStalls(page, "food", "Drinks", [
      "Cold Drinks",
      "Juice Bar",
    ]);

    await addCategoryWithStalls(page, "food", "Dessert", [
      "Sweet Corner",
      "Ice Cream",
    ]);

    await expect(page.getByText("Biryani").first()).toBeVisible();
    await expect(page.getByText("Drinks").first()).toBeVisible();
    await expect(page.getByText("Dessert").first()).toBeVisible();
  });

  test("advance event from draft to active", async ({ page }) => {
    await navigateToEvent(page, eventUrl, "SCB Family Day");

    await page.getByText("Overview", { exact: true }).first().click();

    const advanceBtn = page.getByRole("button", {
      name: /advance to active/i,
    });
    await expect(advanceBtn).toBeVisible({ timeout: 5_000 });
    await advanceBtn.click();

    await expect(page.getByText("active").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("verify full event setup from event list", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    await page.getByText("Active", { exact: true }).first().click();
    await page.waitForTimeout(1_000);

    await expect(page.getByText("SCB Family Day 2026").first()).toBeVisible({
      timeout: 5_000,
    });

    await page
      .locator("[data-slot='card']")
      .filter({ hasText: "SCB Family Day" })
      .first()
      .click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);

    // Verify vendors
    await page.getByText("Vendors", { exact: true }).first().click();
    await page.waitForTimeout(500);

    for (const name of ["Main Gate", "VIP Entrance", "Biryani", "Drinks", "Dessert"]) {
      await expect(page.getByText(name).first()).toBeVisible();
    }

    // Verify categories
    await page.getByText("Categories", { exact: true }).first().click();
    await page.waitForTimeout(500);

    for (const name of ["General", "VIP", "Employee", "Family"]) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });
});
