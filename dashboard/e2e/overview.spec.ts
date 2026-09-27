import { test } from "@playwright/test";

// Visual verification for the Overview redesign: 2 widths x 2 themes x 2
// data states (populated via range=all, empty via range=24h -- the latter
// reliable because the fixtures predate the real system clock, the same
// trick used to test no_data paths earlier in this project). Screenshots
// are read and reviewed by hand after this runs; this spec doesn't assert
// anything itself.
const WIDTHS = [1440, 1920];
const THEMES: ("light" | "dark")[] = ["light", "dark"];
// The page keeps range in React state, not the URL, so switching it means
// clicking the button, not navigating with a query string.
const STATES: { name: string; rangeButton: string }[] = [
  { name: "populated", rangeButton: "All" },
  { name: "empty", rangeButton: "24h" },
];

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    for (const state of STATES) {
      test(`overview ${state.name} ${theme} ${width}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem("theme", t);
        }, theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/");
        await page.getByRole("button", { name: state.rangeButton, exact: true }).click();

        if (state.name === "populated") {
          await page.getByText("Kill switch", { exact: false }).waitFor({ timeout: 15_000 });
        } else {
          await page.getByText("Switch to all time", { exact: false }).waitFor({ timeout: 15_000 });
        }
        // Let the range-change loading flash settle before the shot.
        await page.waitForTimeout(300);

        await page.screenshot({
          path: `e2e/screenshots/overview-${state.name}-${theme}-${width}.png`,
          fullPage: true,
        });
      });
    }
  }
}

test("incidents page smoke check (dark)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/incidents");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "e2e/screenshots/incidents-dark-1440.png", fullPage: true });
});

test("alerts page smoke check (light)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/alerts");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "e2e/screenshots/alerts-light-1440.png", fullPage: true });
});
