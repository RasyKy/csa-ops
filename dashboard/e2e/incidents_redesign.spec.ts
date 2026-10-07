import { test, expect } from "@playwright/test";

test.describe("Incidents Page Redesign", () => {
  // Test: a row that's focused via keyboard and has its title tooltip open doesn't double-fire navigation on Enter/Space
  test("keyboard Enter on focused row with tooltip does not double-fire navigation", async ({ page }) => {
    await page.goto("http://localhost:3000/incidents");
    await page.waitForSelector("table tbody tr");

    // Track navigation events to ensure navigation triggers exactly once
    let navigationCount = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url().includes("/incidents/")) {
        navigationCount++;
      }
    });

    const firstRow = page.locator("table tbody tr").first();
    const actionCell = firstRow.locator('[data-source-tag="ai"]'); // the AI pill, whose tooltip opens on hover

    // Hover to trigger tooltip
    await actionCell.hover();

    // Focus the row via keyboard
    await firstRow.focus();
    await expect(firstRow).toBeFocused();

    // Press Enter to navigate
    await page.keyboard.press("Enter");

    // Wait for the incident detail page to load
    await page.waitForURL(/\/incidents\/inc-/);
    expect(page.url()).toMatch(/\/incidents\/inc-/);

    // Wait a brief tick to ensure no redundant secondary navigation occurs
    await page.waitForTimeout(500);
    expect(navigationCount).toBe(1);
  });

  // Test: Space key also navigates without double-firing
  test("keyboard Space on focused row with tooltip does not double-fire navigation", async ({ page }) => {
    await page.goto("http://localhost:3000/incidents");
    await page.waitForSelector("table tbody tr");

    let navigationCount = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url().includes("/incidents/")) {
        navigationCount++;
      }
    });

    const secondRow = page.locator("table tbody tr").nth(1);
    const actionCell = secondRow.locator('[data-source-tag="ai"]');

    await actionCell.hover();
    await secondRow.focus();
    await expect(secondRow).toBeFocused();

    await page.keyboard.press("Space");
    await page.waitForURL(/\/incidents\/inc-/);
    expect(page.url()).toMatch(/\/incidents\/inc-/);

    await page.waitForTimeout(500);
    expect(navigationCount).toBe(1);
  });

  // Visual Verification: Wide table (1440px) & Narrow cards (640px) across Light & Dark themes
  const THEMES: ("light" | "dark")[] = ["light", "dark"];

  for (const theme of THEMES) {
    test(`visual captures: wide table (1440px, ${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("http://localhost:3000/incidents");
      await page.waitForSelector("table tbody tr");
      await page.waitForTimeout(400);

      // Default state
      await page.screenshot({
        path: `e2e/screenshots/incidents-wide-${theme}.png`,
        fullPage: true,
      });

      // Hover state on the second row to showcase accent bar and bg tint
      const row = page.locator("table tbody tr").nth(1);
      await row.hover();
      await page.waitForTimeout(200);

      await page.screenshot({
        path: `e2e/screenshots/incidents-wide-hover-${theme}.png`,
        fullPage: true,
      });
    });

    test(`visual captures: narrow cards (640px, ${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);
      await page.setViewportSize({ width: 640, height: 900 });
      await page.goto("http://localhost:3000/incidents");
      await page.waitForSelector(".md\\:hidden");
      await page.waitForTimeout(400);

      // Default state
      await page.screenshot({
        path: `e2e/screenshots/incidents-mobile-${theme}.png`,
        fullPage: true,
      });

      // Hover state on first card
      const firstCard = page.locator(".md\\:hidden > div").first();
      await firstCard.hover();
      await page.waitForTimeout(200);

      await page.screenshot({
        path: `e2e/screenshots/incidents-mobile-hover-${theme}.png`,
        fullPage: true,
      });
    });
  }
});
