import type { Page } from "@playwright/test";

/**
 * Navigate to a specific event's detail page.
 * Uses direct URL if available, otherwise finds the event card in the list.
 */
export async function navigateToEvent(
  page: Page,
  eventUrl: string | undefined,
  eventName: string,
) {
  if (eventUrl) {
    await page.goto(eventUrl);
  } else {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");
    await page
      .locator("[data-slot='card']")
      .filter({ hasText: eventName })
      .first()
      .click();
  }
  await page.waitForLoadState("networkidle");
}

/**
 * Add a guest category via the Categories tab.
 * Assumes the Categories tab is already visible.
 */
export async function addCategory(page: Page, name: string) {
  await page.getByRole("button", { name: /add category/i }).click();
  await page.getByPlaceholder("Category name").fill(name);
  await page
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();
  await page.waitForTimeout(500);
}

/**
 * Add a vendor category (entry or food) via the Vendors tab.
 * Assumes the Vendors tab is already visible.
 */
export async function addVendorCategory(
  page: Page,
  type: "entry" | "food",
  name: string,
) {
  await page
    .getByRole("button", { name: new RegExp(`add ${type} category`, "i") })
    .click();
  await page
    .getByPlaceholder(new RegExp(`${type} category`, "i"))
    .fill(name);
  await page
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();
  await page.waitForTimeout(500);
}

/**
 * Open the stall management sheet for a vendor category card,
 * add a stall, then optionally close the sheet.
 */
export async function addStall(page: Page, stallName: string) {
  await page.getByRole("button", { name: /add stall/i }).click();
  await page.getByPlaceholder("Stall name").fill(stallName);
  await page
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();
  await page.waitForTimeout(500);
}

/**
 * Open the Manage Stalls sheet for a specific vendor category card.
 */
export async function openManageStalls(page: Page, categoryName: string) {
  await page
    .locator("[data-slot='card']")
    .filter({ hasText: categoryName })
    .getByRole("button", { name: /manage stalls/i })
    .click();
  await page.waitForTimeout(500);
}

/**
 * Add a vendor category with multiple stalls in one go.
 * Handles: create category → open stalls → add each stall → close sheet.
 */
export async function addCategoryWithStalls(
  page: Page,
  type: "entry" | "food",
  categoryName: string,
  stallNames: string[],
) {
  await addVendorCategory(page, type, categoryName);
  await openManageStalls(page, categoryName);
  for (const name of stallNames) {
    await addStall(page, name);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}
