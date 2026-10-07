import { expect, test, type Locator, type Page } from "@playwright/test";

// The Sign out row of the sidebar: its own row above the footer, labeled when the
// sidebar is expanded and an icon with a tooltip when it is collapsed.

type Theme = "light" | "dark";

function trackIssues(page: Page): () => string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return () => issues;
}

async function open(page: Page, opts: { theme: Theme; collapsed: boolean }) {
  await page.addInitScript(
    ({ theme, collapsed }) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    },
    opts,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("aside")).toBeVisible();
  await expect(
    opts.collapsed ? page.locator('aside button[aria-label="Expand sidebar"]') : page.locator('aside button[aria-label="Collapse sidebar"]'),
  ).toBeVisible();
}

const signOut = (page: Page) => page.locator("aside").getByRole("button", { name: "Sign out" });
const theme = (page: Page) => page.locator('aside button[aria-label*="Switch to"]');
const collapse = (page: Page) => page.locator('aside button[aria-label="Collapse sidebar"]');
const expand = (page: Page) => page.locator('aside button[aria-label="Expand sidebar"]');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const t of ["light", "dark"] as const) {
  test.describe(`sign out row (${t})`, () => {
    test("expanded: a labeled row above the footer, apart from the theme and collapse buttons", async ({ page }) => {
      const issues = trackIssues(page);
      await open(page, { theme: t, collapsed: false });

      const button = signOut(page);
      await expect(button).toBeVisible();
      await expect(button).toContainText("Sign out");
      await expect(button).toHaveAttribute("aria-label", "Sign out");

      const row = page.getByTestId("sidebar-signout-row");
      const footer = page.locator(".sidebar-footer");
      const rowBox = await box(row);
      const footerBox = await box(footer);
      // above the footer row, with a 1px divider on top of each
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(footerBox.y + 1);
      await expect(row).toHaveCSS("border-top-width", "1px");
      await expect(footer).toHaveCSS("border-top-width", "1px");

      // the footer keeps only the theme toggle and the collapse button
      await expect(footer.getByRole("button")).toHaveCount(2);
      await expect(footer.getByRole("button", { name: "Sign out" })).toHaveCount(0);

      const boxes = [await box(button), await box(theme(page)), await box(collapse(page))];
      for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(32);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j]), `${i} vs ${j}`).toBe(false);
      }

      // nav-style: full width of the nav area and the same height as a nav item
      const navItem = await box(page.locator("aside nav a").first());
      expect(Math.abs(boxes[0].height - navItem.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(boxes[0].width - navItem.width)).toBeLessThanOrEqual(1);
      expect(issues()).toEqual([]);
    });

    test("expanded: Tab reaches Sign out before the theme button, then the collapse button", async ({ page }) => {
      const issues = trackIssues(page);
      await open(page, { theme: t, collapsed: false });
      await page.locator("aside nav a").last().focus();
      await page.keyboard.press("Tab");
      await expect(signOut(page)).toBeFocused();
      // a visible focus ring
      const ring = await signOut(page).evaluate((el) => getComputedStyle(el).boxShadow);
      expect(ring).not.toBe("none");
      await page.keyboard.press("Tab");
      await expect(theme(page)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(collapse(page)).toBeFocused();
      expect(issues()).toEqual([]);
    });

    test("collapsed: the icon alone, centered, with a Sign out tooltip on hover and on focus", async ({ page }) => {
      const issues = trackIssues(page);
      await open(page, { theme: t, collapsed: true });

      const button = signOut(page);
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("aria-label", "Sign out");
      expect((await button.innerText()).trim()).toBe("");
      await expect(button.locator("svg")).toHaveCount(1);

      const b = await box(button);
      const aside = await box(page.locator("aside"));
      expect(Math.abs(b.x + b.width / 2 - (aside.x + aside.width / 2))).toBeLessThanOrEqual(1.5);
      expect(b.width).toBeGreaterThanOrEqual(32);
      expect(b.height).toBeGreaterThanOrEqual(32);

      // stacked footer: theme and expand, not overlapping each other or the sign out button
      const others = [await box(theme(page)), await box(expand(page))];
      for (const o of others) {
        expect(o.height).toBeGreaterThanOrEqual(32);
        expect(intersects(b, o)).toBe(false);
      }
      expect(intersects(others[0], others[1])).toBe(false);

      await button.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Sign out");
      await page.mouse.move(700, 400);
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      await theme(page).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(button).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveText("Sign out");
      expect(issues()).toEqual([]);
    });

    test("clicking Sign out ends the session and lands on /login (expanded)", async ({ page }) => {
      const issues = trackIssues(page);
      await open(page, { theme: t, collapsed: false });
      expect((await page.request.get("/api/metrics/summary?range=all")).status()).toBe(200);
      await signOut(page).click();
      await page.waitForURL("**/login");
      expect(new URL(page.url()).pathname).toBe("/login");
      expect((await page.request.get("/api/metrics/summary?range=all")).status()).toBe(401);
      expect(issues()).toEqual([]);
    });

    test("clicking Sign out ends the session and lands on /login (collapsed, by keyboard)", async ({ page }) => {
      const issues = trackIssues(page);
      await open(page, { theme: t, collapsed: true });
      await signOut(page).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL("**/login");
      expect((await page.request.get("/api/incidents")).status()).toBe(401);
      expect(issues()).toEqual([]);
    });
  });
}
