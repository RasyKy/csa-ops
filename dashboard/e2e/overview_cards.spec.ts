import * as fs from "fs";
import * as path from "path";
import { expect, test } from "@playwright/test";

function getPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

const STATES: { name: "populated" | "empty"; rangeButton: string }[] = [
  { name: "populated", rangeButton: "All" },
  { name: "empty", rangeButton: "24h" },
];

const THEMES: ("light" | "dark")[] = ["light", "dark"];

for (const state of STATES) {
  for (const theme of THEMES) {
    test(`overview cards styling: ${state.name} (${theme})`, async ({ page }) => {
      const consoleIssues: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() === "error" || msg.type() === "warning") {
          if (!text.includes("Download the React DevTools") && !text.includes("is outdated")) {
            consoleIssues.push(`${msg.type()}: ${text}`);
          }
        }
      });

      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: state.rangeButton, exact: true }).click();

      if (state.name === "populated") {
        await page.getByText("Automated response", { exact: false }).waitFor({ timeout: 15_000 });
      } else {
        await page.getByText("Switch to all time", { exact: false }).waitFor({ timeout: 15_000 });
      }
      await page.waitForTimeout(300);

      // Resolve expected colors from CSS variables
      const { resolvedSurface, resolvedLine } = await page.evaluate(() => {
        const dummy = document.createElement("div");
        dummy.style.backgroundColor = "var(--surface)";
        dummy.style.borderColor = "var(--line)";
        document.body.appendChild(dummy);
        const surface = window.getComputedStyle(dummy).backgroundColor;
        const line = window.getComputedStyle(dummy).borderColor;
        dummy.remove();
        return { resolvedSurface: surface, resolvedLine: line };
      });

      // Assert card count equals 13
      const cards = page.locator('[data-testid="overview-card"]');
      const cardCount = await cards.count();
      expect(cardCount).toBe(13);

      // Verify each card styling
      const measuredRows: Array<{
        index: number;
        bg: string;
        borderTop: string;
        radius: string;
        match: boolean;
      }> = [];

      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);
        const styles = await card.evaluate((el) => {
          const cs = window.getComputedStyle(el);
          return {
            bg: cs.backgroundColor,
            borderTop: cs.borderTopColor,
            radius: cs.borderTopLeftRadius,
          };
        });

        const match =
          styles.bg === resolvedSurface &&
          styles.borderTop === resolvedLine &&
          styles.radius === "8px";

        measuredRows.push({
          index: i + 1,
          bg: styles.bg,
          borderTop: styles.borderTop,
          radius: styles.radius,
          match,
        });

        expect(styles.bg).toBe(resolvedSurface);
        expect(styles.borderTop).toBe(resolvedLine);
        expect(styles.radius).toBe("8px");
      }

      // Range selector shell
      const rangeShell = page.locator('[data-testid="overview-range"]');
      await expect(rangeShell).toBeVisible();
      const rangeStyles = await rangeShell.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          borderTop: cs.borderTopColor,
          radius: cs.borderTopLeftRadius,
        };
      });
      expect(rangeStyles.bg).toBe(resolvedSurface);
      expect(rangeStyles.borderTop).toBe(resolvedLine);
      expect(rangeStyles.radius).toBe("8px");

      // Banner (when empty state)
      if (state.name === "empty") {
        const banner = page.locator('[data-testid="overview-banner"]');
        await expect(banner).toBeVisible();
        const bannerStyles = await banner.evaluate((el) => {
          const cs = window.getComputedStyle(el);
          return {
            bg: cs.backgroundColor,
            borderTop: cs.borderTopColor,
            radius: cs.borderTopLeftRadius,
          };
        });
        expect(bannerStyles.bg).toBe(resolvedSurface);
        expect(bannerStyles.borderTop).toBe(resolvedLine);
        expect(bannerStyles.radius).toBe("8px");
      }

      // KPI edge alignment: 4th KPI card vs Needs attention row's last card
      // In the layout:
      // card 0: Open incidents
      // card 1: Automated response (last card of Needs attention top row)
      // card 2: Newest incidents (full width)
      // card 3, 4, 5, 6: KPI cards (Alerts, Total incidents, MTTD, MTTR)
      const needsRowLastCard = cards.nth(1); // Automated response (last card of Needs attention top row)
      const lastKpiCard = cards.nth(5); // 4th KPI card (MTTR)

      const needsBox = await needsRowLastCard.boundingBox();
      const kpiBox = await lastKpiCard.boundingBox();
      expect(needsBox).not.toBeNull();
      expect(kpiBox).not.toBeNull();

      const needsRight = needsBox!.x + needsBox!.width;
      const kpiRight = kpiBox!.x + kpiBox!.width;
      const edgeDiff = Math.abs(needsRight - kpiRight);

      console.log(`\n=== Measured Values [${state.name} / ${theme}] ===`);
      console.log(`Resolved --surface: ${resolvedSurface}, --line: ${resolvedLine}`);
      console.log(`Needs attention row last card right edge: ${needsRight.toFixed(2)}px`);
      console.log(`Last KPI card right edge: ${kpiRight.toFixed(2)}px (diff: ${edgeDiff.toFixed(2)}px)`);
      console.log(`| Card # | Background | Border Top | Radius | Match |`);
      console.log(`|--------|------------|------------|--------|-------|`);
      for (const row of measuredRows) {
        console.log(`| ${row.index} | ${row.bg} | ${row.borderTop} | ${row.radius} | ${row.match ? "YES" : "NO"} |`);
      }
      console.log(`| Range Shell | ${rangeStyles.bg} | ${rangeStyles.borderTop} | ${rangeStyles.radius} | YES |`);
      if (state.name === "empty") {
        console.log(`| Banner | ${resolvedSurface} | ${resolvedLine} | 8px | YES |`);
      }

      expect(edgeDiff).toBeLessThanOrEqual(1);

      // No horizontal scroll (scrollWidth <= clientWidth)
      const scrollContainer = page.locator("div.h-screen.overflow-y-auto");
      const hasHScroll = await scrollContainer.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(hasHScroll).toBe(false);

      // Console errors/warnings
      expect(consoleIssues).toHaveLength(0);

      // Screenshots: set viewport height to scrollHeight, capture full Overview
      const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
      expect(scrollHeight).toBeGreaterThan(1200);

      await page.setViewportSize({ width: 1440, height: scrollHeight });
      await page.waitForTimeout(100);

      const screenshotRelPath = `e2e/screenshots/overview-${state.name}-${theme}-1440-v2.png`;
      const fullScreenshotPath = path.join(__dirname, "screenshots", `overview-${state.name}-${theme}-1440-v2.png`);

      await page.screenshot({
        path: fullScreenshotPath,
        fullPage: true,
      });

      const dimensions = getPngDimensions(fullScreenshotPath);
      console.log(`Screenshot ${screenshotRelPath}: ${dimensions.width}x${dimensions.height} (scrollHeight: ${scrollHeight}px)`);
      expect(dimensions.height).toBeGreaterThan(1200);
    });
  }
}
