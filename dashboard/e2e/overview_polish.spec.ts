import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

import { formatDateTime, tzLabel } from "../lib/time";

type Theme = "light" | "dark";

interface Bucket {
  bucket: string;
  severity_counts: Record<string, number>;
}
interface Timeseries {
  range: string;
  since: string | null;
  as_of: string;
  buckets: { status: string; value: Bucket[] };
}
interface Mitre {
  techniques: { value: { technique: string; tactic: string | null; count: number; status: string }[] };
}
interface Top {
  top_hosts: { value: { key: string; count: number }[] };
  top_rules: { value: { key: string; count: number; title?: string }[] };
  fp_rate_by_rule: { value: Record<string, { fp_count: number; total: number; rate: number }> };
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcMonday(ms: number): number {
  const d = new Date(ms);
  return ms - ((d.getUTCDay() + 6) % 7) * DAY_MS;
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

async function openOverview(page: Page, opts: { theme?: Theme; range?: string } = {}) {
  const theme = opts.theme ?? "light";
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const label = opts.range ?? "All";
  const rangeParam = label === "All" ? "all" : label;
  // page.tsx lets an in-flight response for the previous range overwrite the new
  // range's data until the next 3s poll, so wait for two responses of the new range.
  let seen = 0;
  const settled = new Promise<void>((resolve) => {
    page.on("response", (r) => {
      if (r.url().includes("/api/metrics/timeseries") && r.url().includes(`range=${rangeParam}`)) {
        seen += 1;
        if (seen === 2) resolve();
      }
    });
  });
  await page.getByRole("button", { name: label, exact: true }).click();
  await settled;
  await page.getByText("Automated response", { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

function cardByTitle(page: Page, title: string) {
  return page.getByTestId("overview-card").filter({ hasText: title });
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

test.describe("overview polish", () => {
  test("alerts over time: All range fills every day from first bucket to as_of", async ({ page }) => {
    const issues = trackIssues(page);
    const ts = await getJson<Timeseries>(page, "/api/metrics/timeseries?range=all");
    const days = ts.buckets.value.map((b) => utcDay(b.bucket)).sort((a, b) => a - b);
    const span = Math.round((utcDay(ts.as_of) - days[0]) / DAY_MS) + 1;
    expect(span).toBeLessThanOrEqual(90);
    console.log(`All range: first bucket ${new Date(days[0]).toISOString()}, as_of ${ts.as_of}, expected slots ${span}`);

    await openOverview(page);
    const card = cardByTitle(page, "Alerts over time");
    await expect(card.getByText("Alerts per day (UTC days)")).toBeVisible();
    const container = card.getByTestId("timeseries-chart-container");
    const slots = Number(await container.getAttribute("data-slot-count"));
    console.log(`Rendered slots: ${slots}`);
    expect(slots).toBe(span);
    // far more slots than raw buckets: the 40-day gap is filled, not skipped
    expect(slots).toBeGreaterThan(ts.buckets.value.length * 5);

    const ticks = await card.locator("text.recharts-cartesian-axis-tick-value").filter({ hasNotText: /^\d+$/ }).allTextContents();
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);

    expect(issues).toEqual([]);
  });

  test("alerts over time: All range over 90 days aggregates to weeks (mocked)", async ({ page }) => {
    const issues = trackIssues(page);
    const asOf = "2026-10-04T10:00:00.000Z";
    const first = "2026-03-17T00:00:00.000Z";
    const mock: Timeseries = {
      range: "all",
      since: null,
      as_of: asOf,
      buckets: {
        status: "ok",
        value: [
          { bucket: first, severity_counts: { low: 1 } },
          { bucket: "2026-06-01T00:00:00.000Z", severity_counts: { high: 2, medium: 1 } },
          { bucket: "2026-09-30T00:00:00.000Z", severity_counts: { critical: 1 } },
        ],
      },
    };
    await page.route("**/api/metrics/timeseries*", (route) => route.fulfill({ json: mock }));

    const expectedWeeks = Math.round((utcMonday(utcDay(asOf)) - utcMonday(utcDay(first))) / (7 * DAY_MS)) + 1;
    console.log(`Mocked 200-day span: expected weeks ${expectedWeeks}`);
    expect(utcDay(asOf) - utcDay(first)).toBeGreaterThan(90 * DAY_MS);

    await openOverview(page);
    const card = cardByTitle(page, "Alerts over time");
    await expect(card.getByText("Alerts per week", { exact: true })).toBeVisible();
    const slots = Number(await card.getByTestId("timeseries-chart-container").getAttribute("data-slot-count"));
    expect(slots).toBe(expectedWeeks);

    const ticks = await card.locator("text.recharts-cartesian-axis-tick-value").filter({ hasNotText: /^\d+$/ }).allTextContents();
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t).toMatch(/^Week of \d{1,2} [A-Z][a-z]{2}$/);

    // tooltip shows the full bucket label, one row per severity, and a total
    const plot = card.locator(".recharts-wrapper");
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width - 20, box!.y + 100);
    const tooltip = page.getByTestId("timeseries-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Week of \d{1,2} [A-Z][a-z]{2} 20\d\d/);
    await expect(tooltip).toContainText("Total");
    for (const sev of ["critical", "high", "medium", "low"]) await expect(tooltip).toContainText(sev);

    expect(issues).toEqual([]);
  });

  test("alerts by severity: rows, stacked bar, links, copy", async ({ page }) => {
    const ts = await getJson<Timeseries>(page, "/api/metrics/timeseries?range=all");
    const sums: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const b of ts.buckets.value) for (const [s, c] of Object.entries(b.severity_counts)) sums[s] += c;
    const total = Object.values(sums).reduce((a, b) => a + b, 0);

    await openOverview(page);
    const card = cardByTitle(page, "Alerts by severity");
    await expect(card).toBeVisible();

    const rows = card.locator("ul").first().locator("li");
    await expect(rows).toHaveCount(4);
    const order = ["critical", "high", "medium", "low"];
    for (let i = 0; i < 4; i++) {
      const text = ((await rows.nth(i).textContent()) ?? "").toLowerCase();
      expect(text).toContain(order[i]);
      expect(text).toContain(String(sums[order[i]]));
      expect(text).toContain(`${Math.round((sums[order[i]] / total) * 100)}%`);
      expect(await rows.nth(i).locator("a").getAttribute("href")).toBe(`/alerts?severity=${order[i]}`);
    }

    const bar = card.getByTestId("severity-stacked-bar");
    const barBox = (await bar.boundingBox())!;
    const measured: string[] = [];
    for (const sev of order) {
      if (sums[sev] === 0) continue;
      const seg = card.getByTestId(`severity-segment-${sev}`);
      const segBox = (await seg.boundingBox())!;
      const expected = (sums[sev] / total) * barBox.width;
      measured.push(`${sev}: ${segBox.width.toFixed(2)}px vs expected ${expected.toFixed(2)}px`);
      expect(Math.abs(segBox.width - expected)).toBeLessThanOrEqual(1);
    }
    console.log(`Stacked segments (bar ${barBox.width.toFixed(2)}px):\n  ${measured.join("\n  ")}`);

    await expect(page.getByText("Incidents in this range")).toHaveCount(0);
    expect(await page.locator('a[href^="/incidents?severity"]').count()).toBe(0);
    await expect(card.getByText("Top hosts")).toBeVisible();
    await expect(card.getByText("Top rules")).toBeVisible();
  });

  test("top lists: proportional bars, full rule titles, alert links", async ({ page }) => {
    const top = await getJson<Top>(page, "/api/metrics/top?range=all");
    await openOverview(page);
    const card = cardByTitle(page, "Alerts by severity");

    const hostLinks = card.locator('a[href^="/alerts?host="]');
    const ruleLinks = card.locator('a[href^="/alerts?rule_id="]');
    await expect(hostLinks).toHaveCount(top.top_hosts.value.length);
    await expect(ruleLinks).toHaveCount(top.top_rules.value.length);

    for (const [links, items] of [
      [hostLinks, top.top_hosts.value],
      [ruleLinks, top.top_rules.value],
    ] as const) {
      const max = Math.max(...items.map((i) => i.count));
      for (let i = 0; i < items.length; i++) {
        const link = links.nth(i);
        const trackBox = (await link.getByTestId("top-list-bar-track").boundingBox())!;
        const barBox = (await link.getByTestId("top-list-bar").boundingBox())!;
        const expected = (items[i].count / max) * trackBox.width;
        console.log(`${items[i].key}: bar ${barBox.width.toFixed(2)}px expected ${expected.toFixed(2)}px`);
        expect(Math.abs(barBox.width - expected)).toBeLessThanOrEqual(1);
      }
    }

    for (let i = 0; i < top.top_rules.value.length; i++) {
      const rule = top.top_rules.value[i];
      const label = ruleLinks.nth(i).locator("span.line-clamp-2");
      expect(((await label.textContent()) ?? "").trim()).toBe(rule.title);
      expect(await label.getAttribute("title")).toBe(rule.title);
      expect(await ruleLinks.nth(i).getAttribute("href")).toBe(`/alerts?rule_id=${encodeURIComponent(rule.key)}`);
      expect(await ruleLinks.nth(i).locator("span.font-mono").textContent()).toBe(String(rule.count));
    }
  });

  test("mitre heatmap: real data has 9 named cells, no phantom sub-techniques", async ({ page }) => {
    const mitre = await getJson<Mitre>(page, "/api/metrics/mitre?range=all");
    await openOverview(page);
    const card = cardByTitle(page, "MITRE ATT&CK coverage");
    const cells = card.getByTestId("mitre-cell");
    await expect(cells).toHaveCount(mitre.techniques.value.length);
    expect(mitre.techniques.value.length).toBe(9);

    await expect(card.locator('[data-technique="T1048"]')).toContainText("Exfiltration Over Alternative Protocol");
    await expect(card.locator('[data-technique="T1547.001"]')).toContainText("Registry Run Keys / Startup Folder");
    await expect(card.locator('[data-technique="T1003.001"]')).toHaveCount(0);
    await expect(card.locator('[data-technique="T1021.002"]')).toHaveCount(0);
    await expect(card.locator('[data-tactic="__no_tactic__"]')).toHaveCount(0);
    await expect(card.getByText("Tactic not reported")).toHaveCount(0);

    // every cell wraps (no single-line truncation) and carries the full name in title
    const n = await cells.count();
    for (let i = 0; i < n; i++) {
      const cell = cells.nth(i);
      const title = await cell.getAttribute("title");
      expect(title).toContain((await cell.getAttribute("data-technique"))!);
      const ws = await cell.evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(ws).not.toBe("nowrap");
    }

    // fired cells first, by count descending, within a tactic
    const execution = card.locator('[data-tactic="execution"] [data-testid="mitre-cell"]');
    await expect(execution.first()).toHaveAttribute("data-technique", "T1059.001");
    await expect(execution.nth(1)).toHaveAttribute("data-technique", "T1047");

    for (const legend of ["Fewer alerts", "More alerts", "Covered, no alerts yet"]) {
      await expect(card.getByText(legend)).toBeVisible();
    }
  });

  test("mitre heatmap: Tactic not reported column appears for a null-tactic cell (mocked)", async ({ page }) => {
    await page.route("**/api/metrics/mitre*", (route) =>
      route.fulfill({
        json: {
          range: "all",
          since: null,
          as_of: new Date().toISOString(),
          coverage_status: "ok",
          techniques: {
            status: "ok",
            value: [
              { technique: "T1059.001", tactic: "execution", count: 2, status: "fired" },
              { technique: "T9999", tactic: null, count: 1, status: "fired" },
            ],
          },
        },
      }),
    );
    await openOverview(page);
    const card = cardByTitle(page, "MITRE ATT&CK coverage");
    await expect(card.locator('[data-tactic="__no_tactic__"]')).toHaveCount(1);
    await expect(card.getByText("Tactic not reported")).toBeVisible();
    await expect(card.getByTestId("mitre-cell")).toHaveCount(2);
  });

  test("detection quality: counts, readable names, sort order, empty state", async ({ page }) => {
    const top = await getJson<Top>(page, "/api/metrics/top?range=all");
    await openOverview(page);
    const card = cardByTitle(page, "Detection quality");
    const rows = card.getByTestId("detection-quality-row");

    const expected = Object.entries(top.fp_rate_by_rule.value)
      .sort(([, a], [, b]) => b.total - a.total || b.rate - a.rate)
      .slice(0, 3)
      .map(([rule]) => rule);
    await expect(rows).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await expect(rows.nth(i)).toHaveAttribute("data-rule", expected[i]);
    }

    const ps = card.locator('[data-rule="T1059.001_encoded_powershell"]');
    await expect(ps).toContainText("50%");
    await expect(ps).toContainText("1 of 2 alerts");
    await expect(ps).toContainText("Base64-Encoded PowerShell Command");
    const port = card.locator('[data-rule="T1046_port_scan"]');
    await expect(port).toContainText("Port scan");
    await expect(port.locator("span[title]").first()).toHaveAttribute("title", "T1046_port_scan");
    await expect(port).toContainText("100%");
    await expect(port).toContainText("1 of 1 alerts");
  });

  test("detection quality: empty copy (mocked)", async ({ page }) => {
    await page.route("**/api/metrics/top*", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.fp_rate_by_rule = { value: {}, status: "no_data" };
      await route.fulfill({ json });
    });
    await openOverview(page);
    await expect(cardByTitle(page, "Detection quality").getByText("No analyst-labeled alerts yet")).toBeVisible();
  });

  test("response and triage cards use plain language", async ({ page }) => {
    await openOverview(page);
    await expect(page.getByTestId("response-live-status")).toHaveText("None yet");
    await expect(page.getByTestId("response-practice-status")).toHaveText("5 logged, not executed");
    await expect(page.getByTestId("triage-failed-runs")).toHaveText("0 of 5");
  });

  test("response card shows succeeded of total when live actions exist (mocked)", async ({ page }) => {
    await page.route("**/api/metrics/response*", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.live = { value: { total: 4, succeeded: 3, rate: 0.75 }, status: "ok" };
      await route.fulfill({ json });
    });
    await openOverview(page);
    await expect(page.getByTestId("response-live-status")).toHaveText("3 of 4 succeeded");
  });

  test("pipeline health: heading, subtitle, not connected, exact-time titles", async ({ page }) => {
    await openOverview(page);
    const card = cardByTitle(page, "Pipeline health");
    await expect(card.getByRole("heading", { name: /^Pipeline health/ })).toBeVisible();
    await expect(card.getByText("All-time totals")).toBeVisible();
    await expect(card.getByText(/Time since the most recent/)).toHaveCount(0);

    const ingestion = card.getByTestId("pipeline-source-logs-normalized");
    await expect(ingestion).toContainText("Not connected");
    await expect(ingestion.getByTestId("ingestion-hollow-dot")).toBeVisible();

    const pipeline = await getJson<{ sources: Record<string, { value: { latest_timestamp: string | null } | null }> }>(
      page,
      "/api/metrics/pipeline",
    );
    for (const [source, health] of Object.entries(pipeline.sources)) {
      const ts = health.value?.latest_timestamp;
      if (!ts) continue;
      const row = card.getByTestId(`pipeline-source-${source}`);
      const expected = `${formatDateTime(ts)} ${tzLabel()}`;
      await expect(row).toHaveAttribute("title", expected);
      console.log(`${source}: title "${expected}"`);
      await expect(row.getByTestId("ingestion-dot")).toHaveCount(0);
    }
  });

  for (const [label, ageMs, cls] of [
    ["2 minutes", 2 * 60_000, "bg-emerald-500"],
    ["20 minutes", 20 * 60_000, "bg-amber-500"],
    ["3 hours", 3 * 3_600_000, "bg-red-500"],
  ] as const) {
    test(`pipeline health: ingestion freshness dot for ${label} old data (mocked)`, async ({ page }) => {
      await page.route("**/api/metrics/pipeline*", async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        const ts = new Date(Date.now() - ageMs).toISOString();
        json.sources["logs-normalized"] = { value: { count: 1234, latest_timestamp: ts }, status: "ok" };
        await route.fulfill({ json });
      });
      await openOverview(page);
      const row = page.getByTestId("pipeline-source-logs-normalized");
      await expect(row.getByTestId("ingestion-dot")).toBeVisible();
      await expect(row).toContainText("Last event");
      const actual = await row.getByTestId("ingestion-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
      const expectedColor = await page.evaluate((c) => {
        const d = document.createElement("div");
        d.className = c;
        document.body.appendChild(d);
        const v = getComputedStyle(d).backgroundColor;
        d.remove();
        return v;
      }, cls);
      console.log(`Ingestion ${label}: dot ${actual}, expected ${cls} = ${expectedColor}`);
      expect(actual).toBe(expectedColor);
      const title = await row.getAttribute("title");
      expect(title).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}:\d{2} UTC[+-]/);
    });
  }

  for (const theme of ["light", "dark"] as Theme[]) {
    test(`sentence-case headings, 24h times, no horizontal scroll (${theme})`, async ({ page }) => {
      const issues = trackIssues(page);
      await openOverview(page, { theme });
      const main = page.locator("main");

      const uppercase = await main.evaluate((root) => {
        const bad: string[] = [];
        for (const el of Array.from(root.querySelectorAll("*"))) {
          if (getComputedStyle(el).textTransform === "uppercase") bad.push(el.tagName + ":" + (el.textContent ?? "").slice(0, 30));
        }
        return bad;
      });
      expect(uppercase).toEqual([]);

      const text = await main.innerText();
      expect(text).not.toMatch(/\b\d{1,2}:\d{2}(:\d{2})? ?(AM|PM)\b/i);
      await expect(main.getByText(/^Updated \d{2}:\d{2}:\d{2} UTC[+-]\d/)).toBeVisible();

      for (const heading of ["Needs attention", "Open incidents", "Alerts over time", "Alerts by severity", "Pipeline health"]) {
        await expect(main.getByText(heading, { exact: false }).first()).toBeVisible();
      }

      const container = page.locator("div.h-screen.overflow-y-auto");
      expect(await container.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
      expect(issues).toEqual([]);
    });
  }

  for (const state of [
    { name: "populated", range: "All" },
    { name: "empty", range: "24h" },
  ]) {
    for (const theme of ["light", "dark"] as Theme[]) {
      test(`screenshot v3: ${state.name} ${theme}`, async ({ page }) => {
        const issues = trackIssues(page);
        await openOverview(page, { theme, range: state.range });
        if (state.name === "empty") {
          await page.getByText("Switch to all time", { exact: false }).waitFor({ timeout: 15_000 });
        }

        const container = page.locator("div.h-screen.overflow-y-auto");
        expect(await container.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
        const scrollHeight = await container.evaluate((el) => el.scrollHeight);
        await page.setViewportSize({ width: 1440, height: scrollHeight });
        await page.waitForTimeout(200);

        const file = path.join(__dirname, "screenshots", `overview-${state.name}-${theme}-1440-v3.png`);
        await page.screenshot({ path: file, fullPage: true });
        const dim = getPngDimensions(file);
        console.log(`Screenshot overview-${state.name}-${theme}-1440-v3.png: ${dim.width}x${dim.height}`);
        expect(dim.height).toBeGreaterThan(1200);
        expect(issues).toEqual([]);
      });
    }
  }
});
