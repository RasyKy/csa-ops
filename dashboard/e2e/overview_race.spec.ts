import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";

const DAY_MS = 86_400_000;

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function getPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function trackIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return issues;
}

function datasets() {
  const now = Date.now();
  const today = utcDayStart(now);
  const asOf = new Date(now).toISOString();
  const iso = (ms: number) => new Date(ms).toISOString();
  const sevenDay = {
    range: "7d",
    since: iso(now - 7 * DAY_MS),
    as_of: asOf,
    buckets: {
      status: "ok",
      value: [
        { bucket: iso(today - 5 * DAY_MS), severity_counts: { low: 1 } },
        { bucket: iso(today - 3 * DAY_MS), severity_counts: { medium: 2 } },
        { bucket: iso(today - 1 * DAY_MS), severity_counts: { high: 1 } },
      ],
    },
  };
  const all = {
    range: "all",
    since: null,
    as_of: asOf,
    buckets: {
      status: "ok",
      value: [
        { bucket: iso(today - 39 * DAY_MS), severity_counts: { low: 1 } },
        { bucket: iso(today - 5 * DAY_MS), severity_counts: { critical: 2 } },
      ],
    },
  };
  return { sevenDay, all, allSpan: 40 };
}

async function sampleSlots(page: Page, count: number, intervalMs: number): Promise<(number | null)[]> {
  const samples: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const v = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeseries-chart-container"]');
      return el ? Number(el.getAttribute("data-slot-count")) : null;
    });
    samples.push(v);
    await page.waitForTimeout(intervalMs);
  }
  return samples;
}

function assertNeverReturns(samples: (number | null)[], staleCount: number, finalCount: number) {
  const firstAll = samples.findIndex((s) => s === finalCount);
  expect(firstAll, "All data should appear within the sampling window").toBeGreaterThanOrEqual(0);
  const after = samples.slice(firstAll);
  expect(after.filter((s) => s === staleCount)).toEqual([]);
  expect(after.filter((s) => s !== finalCount)).toEqual([]);
  expect(samples[samples.length - 1]).toBe(finalCount);
}

test.describe("overview stale-response race", () => {
  test("7d response delayed 1500ms, All immediate: 7d data never overwrites All", async ({ page }) => {
    const issues = trackIssues(page);
    const { sevenDay, all, allSpan } = datasets();
    await page.route("**/api/metrics/timeseries*", async (route) => {
      const url = route.request().url();
      if (url.includes("range=7d")) {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ json: sevenDay });
      } else {
        await route.fulfill({ json: all });
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const samples = await sampleSlots(page, 40, 100);
    console.log(`Direction A (7d delayed) slot samples every 100ms:\n${samples.map((s) => (s === null ? "-" : s)).join(" ")}`);

    // 7d dataset renders 8 daily slots; All renders allSpan
    assertNeverReturns(samples, 8, allSpan);
    expect(issues).toEqual([]);
  });

  test("All response delayed 1500ms, 7d immediate: 7d data never overwrites All", async ({ page }) => {
    const issues = trackIssues(page);
    const { sevenDay, all, allSpan } = datasets();
    await page.route("**/api/metrics/timeseries*", async (route) => {
      const url = route.request().url();
      if (url.includes("range=all")) {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ json: all });
      } else {
        await route.fulfill({ json: sevenDay });
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("timeseries-chart-container")).toHaveAttribute("data-slot-count", "8");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const samples = await sampleSlots(page, 40, 100);
    console.log(`Direction B (All delayed) slot samples every 100ms:\n${samples.map((s) => (s === null ? "-" : s)).join(" ")}`);

    assertNeverReturns(samples, 8, allSpan);
    expect(issues).toEqual([]);
  });
});

async function openPopulated(page: Page, theme: Theme) {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const settled = page.waitForResponse(
    (r) => r.url().includes("/api/metrics/timeseries") && r.url().includes("range=all"),
  );
  await page.getByRole("button", { name: "All", exact: true }).click();
  await settled;
  await page.getByText("Automated response", { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(700);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test.describe(`overview layout leftovers (${theme})`, () => {
    test("alerts over time: no large empty band under the legend", async ({ page }) => {
      await openPopulated(page, theme);
      const card = page.getByTestId("overview-card").filter({ hasText: "Alerts over time" });
      const cardBox = (await card.boundingBox())!;
      const legendBox = (await card.locator("ul.justify-center").boundingBox())!;
      const gap = cardBox.y + cardBox.height - (legendBox.y + legendBox.height);
      console.log(
        `[${theme}] card ${cardBox.height.toFixed(1)}px tall, legend bottom to card bottom gap ${gap.toFixed(1)}px (limit 24)`,
      );
      expect(gap).toBeLessThanOrEqual(24);
      expect(gap).toBeGreaterThanOrEqual(0);
      const container = card.getByTestId("timeseries-chart-container");
      expect((await container.boundingBox())!.height).toBeGreaterThanOrEqual(220);
    });

    test("mttr card: two-line text, no ellipsis, no overflow", async ({ page }) => {
      const issues = trackIssues(page);
      await openPopulated(page, theme);
      const card = page.getByTestId("overview-card").filter({ hasText: "No live responses yet" });
      await expect(card).toHaveCount(1);
      await expect(card.getByText("No live responses yet", { exact: true })).toBeVisible();
      await expect(card.getByText("5 logged in practice mode", { exact: true })).toBeVisible();
      await expect(card).not.toContainText("(5 in practice");

      const report = await card.evaluate((root) => {
        const out: { tag: string; text: string; textOverflow: string; scrollWidth: number; clientWidth: number }[] = [];
        for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
          const cs = getComputedStyle(el);
          out.push({
            tag: el.tagName,
            text: (el.textContent ?? "").trim().slice(0, 40),
            textOverflow: cs.textOverflow,
            scrollWidth: (el as HTMLElement).scrollWidth,
            clientWidth: (el as HTMLElement).clientWidth,
          });
        }
        return out;
      });
      for (const r of report) {
        expect(r.textOverflow, `${r.tag} "${r.text}"`).not.toBe("ellipsis");
        if (r.clientWidth > 0) expect(r.scrollWidth, `${r.tag} "${r.text}"`).toBeLessThanOrEqual(r.clientWidth);
      }
      console.log(`[${theme}] MTTR card elements checked: ${report.length}, none ellipsized or overflowing`);
      expect(issues).toEqual([]);
    });

    test("screenshot v4", async ({ page }) => {
      const issues = trackIssues(page);
      await openPopulated(page, theme);
      const container = page.locator("div.h-screen.overflow-y-auto");
      const scrollHeight = await container.evaluate((el) => el.scrollHeight);
      await page.setViewportSize({ width: 1440, height: scrollHeight });
      await page.waitForTimeout(300);
      const file = path.join(__dirname, "screenshots", `overview-populated-${theme}-1440-v4.png`);
      await page.screenshot({ path: file, fullPage: true });
      const dim = getPngDimensions(file);
      console.log(`Screenshot overview-populated-${theme}-1440-v4.png: ${dim.width}x${dim.height}`);
      expect(dim.height).toBeGreaterThan(1200);
      expect(issues).toEqual([]);
    });
  });
}
