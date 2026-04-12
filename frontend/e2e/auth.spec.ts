import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("unauthenticated user sees login or loading state", async ({ page }) => {
    await page.goto("/events");
    // With expectAuth, the page may show Loading until auth resolves, then redirect
    await expect(
      page.getByText("Sign In").or(page.getByText("Loading")),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("login page renders sign-in form", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);

    await expect(page.getByText("Sign In").first()).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
  });

  test("sign-up toggle switches form mode", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);

    await page.getByText("Need an account? Sign up").click();
    await page.waitForTimeout(500);

    await expect(page.getByText("Create Account").first()).toBeVisible();
    await expect(page.getByPlaceholder("Name")).toBeVisible();

    await page.getByText("Already have an account? Sign in").click();
    await page.waitForTimeout(500);
    await expect(page.getByText("Sign In").first()).toBeVisible();
  });
});
