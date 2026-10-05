import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  agreementDetailText,
  agreementText,
  formatDuration,
  medianResolveText,
  statusCountsText,
} from "../lib/caseMetricsDisplay";
import { E2E_DATA_ROOT } from "../playwright.config";
import type { MetricsCases } from "../lib/types";

const REALISTIC = Boolean(process.env.E2E_REALISTIC);
const CASES_FILE = path.join(E2E_DATA_ROOT, "cases.json");
const SHOTS = path.join(__dirname, "screenshots");

// All case spec files share one cases.json in the temp DATA_ROOT, and Playwright
// runs spec files in parallel workers. A mutating describe holds this lock folder
// from its beforeAll to its afterAll so the case specs take turns.
const LOCK_DIR = path.join(path.dirname(E2E_DATA_ROOT), "csa-ops-e2e-cases.lock");
const LOCK_STALE_MS = 5 * 60_000;

async function acquireCasesLock() {
  for (let i = 0; i < 4800; i++) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
        // released by its owner in the meantime
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Timed out waiting for the case specs lock");
}

function releaseCasesLock() {
  fs.rmSync(CASES_FILE, { force: true });
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Pure tests

test.describe("caseMetricsDisplay: unit", () => {
  test("formatDuration", () => {
    const rows: [number, string][] = [
      [0, "0 s"],
      [1, "1 s"],
      [45, "45 s"],
      [59, "59 s"],
      [59.6, "1 min"],
      [60, "1 min"],
      [90, "2 min"],
      [720, "12 min"],
      [3540, "59 min"],
      [3570, "1 h"],
      [3600, "1 h"],
      [3900, "1 h 5 min"],
      [11100, "3 h 5 min"],
      [86399, "1 d"],
      [86400, "1 d"],
      [187200, "2 d 4 h"],
      [172800, "2 d"],
    ];
    for (const [seconds, text] of rows) expect(formatDuration(seconds), String(seconds)).toBe(text);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "5", {}]) {
      expect(formatDuration(bad), String(bad)).toBe("-");
    }
  });

  test("agreementText counts, never percentages", () => {
    expect(agreementText({ resolved_total: 7, agree: 5 })).toBe("5 of 7 resolved incidents");
    expect(agreementText({ resolved_total: 1, agree: 1 })).toBe("1 of 1 resolved incident");
    expect(agreementText({ resolved_total: 3, agree: 0 })).toBe("0 of 3 resolved incidents");
    expect(agreementText({ resolved_total: 0, agree: 0 })).toBe("No resolved incidents yet");
    for (const none of [null, undefined, {}, { resolved_total: "x" }, { resolved_total: -2 }, { resolved_total: Number.NaN }]) {
      expect(agreementText(none as never), String(none)).toBe("No resolved incidents yet");
    }
    expect(agreementText({ resolved_total: 7, agree: 5 })).not.toContain("%");
  });

  test("agreementDetailText", () => {
    expect(agreementDetailText({ resolved_total: 10, agree: 5, disagree: 1, unscored: 2, ai_uncertain: 1 })).toBe(
      "1 disagree, 2 not scored, 1 uncertain",
    );
    expect(agreementDetailText({ resolved_total: 10, unscored: 2, ai_uncertain: 1 })).toBe("2 not scored, 1 uncertain");
    expect(agreementDetailText({ resolved_total: 4, agree: 4, disagree: 0, unscored: 0, ai_uncertain: 0 })).toBeNull();
    expect(agreementDetailText({ resolved_total: 0, unscored: 3 })).toBeNull();
    expect(agreementDetailText(null)).toBeNull();
  });

  test("statusCountsText", () => {
    expect(statusCountsText({ open: 3, investigating: 2, resolved: 3 })).toBe("3 open · 2 investigating · 3 resolved");
    expect(statusCountsText({ open: 0, investigating: 0, resolved: 0 })).toBe("0 open · 0 investigating · 0 resolved");
    expect(statusCountsText(null)).toBe("0 open · 0 investigating · 0 resolved");
    expect(statusCountsText({ open: "x", investigating: -1, resolved: Number.NaN } as never)).toBe(
      "0 open · 0 investigating · 0 resolved",
    );
  });

  test("medianResolveText", () => {
    expect(medianResolveText({ count: 3, median_seconds: 720 })).toBe("Median time to resolve: 12 min (3 resolved)");
    expect(medianResolveText({ count: 1, median_seconds: 45 })).toBe("Median time to resolve: 45 s (1 resolved)");
    expect(medianResolveText({ count: 0, median_seconds: null })).toBeNull();
    expect(medianResolveText({ count: 2, median_seconds: null })).toBeNull();
    expect(medianResolveText({ count: 0, median_seconds: 5 })).toBeNull();
    expect(medianResolveText(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Browser helpers

function trackIssues(page: Page, tolerateStatus: number[] = []): () => string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    const m = /Failed to load resource: the server responded with a status of (\d+)/.exec(text);
    if (m && tolerateStatus.includes(Number(m[1]))) return;
    issues.push(`${msg.type()}: ${text}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return () => issues;
}

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Saved before any assertion about the picture, so a failing run still leaves it to look at.
async function shot(locator: Locator, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await locator.screenshot({ path: file });
  const size = pngSize(file);
  console.log(`${name} ${size.width}x${size.height}`);
  return size;
}

function expectUsable(size: { width: number; height: number }) {
  expect(size.width).toBeGreaterThan(200);
  expect(size.height).toBeGreaterThan(60);
}

// Same guard as the other case specs: the backend must be using the temp DATA_ROOT.
async function assertTempDataRoot(request: APIRequestContext) {
  fs.mkdirSync(E2E_DATA_ROOT, { recursive: true });
  const sentinel = {
    "e2e-sentinel": {
      incident_id: "e2e-sentinel",
      status: "open",
      assignee: null,
      verdict: null,
      resolution_note: null,
      resolved_time: null,
      updated_time: "2026-01-01T00:00:00.000Z",
      events: [{ id: "evt-1", time: "2026-01-01T00:00:00.000Z", actor: "e2e", type: "created", data: {} }],
      version: 1,
    },
  };
  fs.writeFileSync(CASES_FILE, JSON.stringify(sentinel));
  const res = await request.get("/api/cases");
  const list = res.ok() ? ((await res.json()) as { incident_id: string }[]) : [];
  fs.rmSync(CASES_FILE, { force: true });
  if (!list.some((c) => c.incident_id === "e2e-sentinel")) {
    throw new Error(
      `The backend is not using the temp DATA_ROOT (${E2E_DATA_ROOT}), so case tests would write to the repo's data/. ` +
        "Stop the backend on port 8000 and let Playwright start it, or start it with DATA_ROOT set to that folder.",
    );
  }
}

const caseUrl = (id: string) => `/api/incidents/${id}/case`;
const resolveCase = (page: Page, id: string, verdict: string, note?: string) =>
  page.request.post(`${caseUrl(id)}/resolve`, { data: { verdict, ...(note ? { note } : {}) }, headers: { "x-actor": "Tester" } });

// Real writes only to inc-0001 and inc-0005, like the other case specs.
async function resolveTwo(page: Page) {
  expect((await resolveCase(page, "inc-0001", "false_positive", "Admin tooling.")).status()).toBe(200);
  expect((await resolveCase(page, "inc-0005", "true_positive")).status()).toBe(200);
}

async function metricsCases(page: Page): Promise<MetricsCases> {
  const res = await page.request.get("/api/metrics/cases?range=all");
  expect(res.ok()).toBe(true);
  return (await res.json()) as MetricsCases;
}

// The Overview opens on 7 days; the fixtures are older, so switch to All and wait
// for the new range's data (an in-flight response of the old range can land first).
async function openOverview(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  let seen = 0;
  const settled = new Promise<void>((resolve) => {
    page.on("response", (r) => {
      if (r.url().includes("/api/metrics/cases") && r.url().includes("range=all")) {
        seen += 1;
        if (seen === 2) resolve();
      }
    });
  });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await settled;
  await page.getByText("Automated response", { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

const card = (page: Page, title: string) => page.getByTestId("overview-card").filter({ hasText: title });
const openCard = (page: Page) => card(page, "Open incidents");
// Other cards mention these words in passing, so find the card by its own heading.
const cardByHeading = (page: Page, heading: RegExp) =>
  page.getByTestId("overview-card").filter({ has: page.locator("h3", { hasText: heading }) });
const triageCard = (page: Page) => cardByHeading(page, /^AI triage/);
const detectionCard = (page: Page) => cardByHeading(page, /^Detection quality/);

async function cardCount(page: Page) {
  return page.getByTestId("overview-card").count();
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("div.h-screen.min-w-0.flex-1.overflow-y-auto");
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
    };
  });
}

function agreementTemplate(m: MetricsCases): string {
  const a = m.ai_agreement.value;
  return a.resolved_total === 0
    ? "No resolved incidents yet"
    : `${a.agree} of ${a.resolved_total} resolved incident${a.resolved_total === 1 ? "" : "s"}`;
}

function statusTemplate(m: MetricsCases): string {
  const c = m.status_counts.value;
  return `${c.open} open · ${c.investigating} investigating · ${c.resolved} resolved`;
}

// ---------------------------------------------------------------------------
// Default backend, temp DATA_ROOT

test.describe("case metrics on the Overview (default backend, temp DATA_ROOT)", () => {
  test.skip(REALISTIC, "mutating tests run only against the default backend");

  test.beforeAll(async ({ request }) => {
    test.setTimeout(10 * 60_000);
    await acquireCasesLock();
    await assertTempDataRoot(request);
  });

  test.afterAll(() => {
    releaseCasesLock();
  });

  test.beforeEach(() => {
    fs.rmSync(CASES_FILE, { force: true });
  });

  test("1. with two resolved cases the three cards show the numbers the API returns", async ({ page }) => {
    const issues = trackIssues(page);

    // The fixture-label rows of Detection quality before any case exists.
    await openOverview(page);
    const fixtureRows = detectionCard(page).getByTestId("detection-quality-row");
    const rowsBefore = await fixtureRows.evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));
    expect(rowsBefore.length).toBeGreaterThan(0);

    await resolveTwo(page);
    const api = await metricsCases(page);
    expect(api.status_counts.status).toBe("ok");
    expect(api.ai_agreement.value.resolved_total).toBe(2);
    expect(api.resolve_time.value.count).toBe(2);

    await openOverview(page);
    expect(await cardCount(page)).toBe(13);

    // Open incidents: counts and the median line.
    await expect(openCard(page).getByTestId("case-status-counts")).toHaveText(statusTemplate(api));
    await expect(openCard(page).getByTestId("case-median-resolve")).toHaveText(
      `Median time to resolve: ${formatDuration(api.resolve_time.value.median_seconds)} (${api.resolve_time.value.count} resolved)`,
    );

    // AI triage: Analyst agreement, with the counts the API returned.
    await expect(triageCard(page).getByTestId("analyst-agreement")).toContainText("Analyst agreement");
    await expect(triageCard(page).getByTestId("analyst-agreement-text")).toHaveText(agreementTemplate(api));
    const a = api.ai_agreement.value;
    const detail = triageCard(page).getByTestId("analyst-agreement-detail");
    if (a.disagree + a.unscored + a.ai_uncertain > 0) {
      await expect(detail).toBeVisible();
    } else {
      await expect(detail).toHaveCount(0);
    }

    // Detection quality: the Analyst verdicts block, one row per rule the API lists.
    const byRule = api.verdicts_by_rule.value;
    const expectedRules = Object.entries(byRule)
      .sort(([ra, x], [rb, y]) => y.total - x.total || ra.localeCompare(rb))
      .slice(0, 5)
      .map(([rule]) => rule);
    expect(expectedRules).toEqual(expect.arrayContaining(["T1012_registry_query", "T1046_port_scan"]));
    const verdictBlock = detectionCard(page).getByTestId("analyst-verdicts");
    await expect(verdictBlock).toContainText("Analyst verdicts");
    const verdictRows = verdictBlock.getByTestId("analyst-verdict-row");
    await expect(verdictRows).toHaveCount(expectedRules.length);
    for (let i = 0; i < expectedRules.length; i++) {
      const row = verdictRows.nth(i);
      const counts = byRule[expectedRules[i]];
      await expect(row).toHaveAttribute("data-rule", expectedRules[i]);
      await expect(row).toContainText(`${counts.false_positive} of ${counts.total} false positive`);
      if (counts.benign_activity > 0) await expect(row).toContainText(`${counts.benign_activity} benign`);
    }
    // inc-0001 (false positive) raised T1012_registry_query; inc-0005 (true positive) raised T1046_port_scan.
    await expect(verdictBlock.locator('[data-rule="T1012_registry_query"]')).toContainText("1 of 1 false positive");
    await expect(verdictBlock.locator('[data-rule="T1046_port_scan"]')).toContainText("0 of 1 false positive");

    // The existing fixture-label rows did not change.
    const rowsAfter = await detectionCard(page).getByTestId("detection-quality-row").evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).innerText),
    );
    expect(rowsAfter).toEqual(rowsBefore);

    expect(issues()).toEqual([]);
  });

  test("2. no resolved case: the rows say so and there is no median line", async ({ page }) => {
    const issues = trackIssues(page);
    await openOverview(page);
    expect(await cardCount(page)).toBe(13);
    const api = await metricsCases(page);
    expect(api.ai_agreement.value.resolved_total).toBe(0);

    await expect(triageCard(page).getByTestId("analyst-agreement-text")).toHaveText("No resolved incidents yet");
    await expect(triageCard(page).getByTestId("analyst-agreement-detail")).toHaveCount(0);
    await expect(openCard(page).getByTestId("case-status-counts")).toHaveText("5 open · 0 investigating · 0 resolved");
    await expect(openCard(page).getByTestId("case-median-resolve")).toHaveCount(0);
    await expect(detectionCard(page).getByTestId("analyst-verdicts")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("3. /api/metrics/cases unavailable: none of the new rows render and there is no error banner", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    expect((await resolveCase(page, "inc-0001", "false_positive")).status()).toBe(200);
    await page.route("**/api/metrics/cases*", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByText("Automated response", { exact: false }).first().waitFor({ timeout: 15_000 });
    await expect(openCard(page)).toBeVisible();
    await page.waitForTimeout(4000); // a full poll cycle or more with the 503 in place

    await expect(page.getByTestId("analyst-agreement")).toHaveCount(0);
    await expect(page.getByTestId("case-counts")).toHaveCount(0);
    await expect(page.getByTestId("analyst-verdicts")).toHaveCount(0);
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);
    expect(await cardCount(page)).toBe(13);
    // everything else on the cards is still there
    await expect(triageCard(page)).toContainText("AI triage");
    await expect(detectionCard(page).getByTestId("detection-quality-row").first()).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("4. formatting of a crafted response: disagreements, unscored, uncertain, benign counts and order", async ({ page }) => {
    const issues = trackIssues(page);
    const body = {
      range: "all",
      since: null,
      as_of: "2026-10-05T00:00:00.000Z",
      status_counts: { value: { open: 3, investigating: 2, resolved: 10 }, status: "ok" },
      ai_agreement: {
        value: {
          resolved_total: 10,
          scored: 6,
          agree: 5,
          disagree: 1,
          ai_uncertain: 1,
          unscored: 3,
          confusion: {
            ai_malicious_analyst_malicious: 4,
            ai_malicious_analyst_benign: 1,
            ai_benign_analyst_malicious: 0,
            ai_benign_analyst_benign: 1,
          },
        },
        status: "ok",
      },
      resolve_time: { value: { count: 10, median_seconds: 11100, p90_seconds: 90000, values_seconds: [11100] }, status: "ok" },
      verdicts_by_rule: {
        value: {
          T1003_lsass_access: { true_positive: 3, false_positive: 0, benign_activity: 0, undetermined: 0, total: 3 },
          T1059_encoded_powershell: { true_positive: 1, false_positive: 3, benign_activity: 1, undetermined: 0, total: 5 },
          T1105_file_drop: { true_positive: 0, false_positive: 1, benign_activity: 0, undetermined: 1, total: 2 },
          T1021_lateral_movement_smb: { true_positive: 1, false_positive: 0, benign_activity: 0, undetermined: 0, total: 1 },
          T1047_wmi_lateral_movement: { true_positive: 1, false_positive: 0, benign_activity: 0, undetermined: 0, total: 1 },
          T1046_port_scan: { true_positive: 1, false_positive: 0, benign_activity: 0, undetermined: 0, total: 1 },
        },
        status: "ok",
      },
    };
    await page.route("**/api/metrics/cases*", (route) => route.fulfill({ json: body }));
    await openOverview(page);

    await expect(openCard(page).getByTestId("case-status-counts")).toHaveText("3 open · 2 investigating · 10 resolved");
    await expect(openCard(page).getByTestId("case-median-resolve")).toHaveText("Median time to resolve: 3 h 5 min (10 resolved)");
    await expect(triageCard(page).getByTestId("analyst-agreement-text")).toHaveText("5 of 10 resolved incidents");
    await expect(triageCard(page).getByTestId("analyst-agreement-detail")).toHaveText("1 disagree, 3 not scored, 1 uncertain");

    const rows = detectionCard(page).getByTestId("analyst-verdict-row");
    await expect(rows).toHaveCount(5); // six rules, the five with the most alerts
    const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")));
    expect(order).toEqual([
      "T1059_encoded_powershell",
      "T1003_lsass_access",
      "T1105_file_drop",
      "T1021_lateral_movement_smb",
      "T1046_port_scan",
    ]);
    await expect(rows.nth(0)).toContainText("3 of 5 false positive");
    await expect(rows.nth(0)).toContainText("1 benign");
    await expect(rows.nth(1)).toContainText("0 of 3 false positive");
    await expect(rows.nth(1)).not.toContainText("benign");
    // case text rendered as plain text: nothing here is HTML
    await expect(page.getByTestId("analyst-agreement")).not.toContainText("%");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("5. the case metrics ride the existing poll: once per cycle, never overlapping", async ({ page }) => {
    const issues = trackIssues(page);
    let inFlight = 0;
    let maxInFlight = 0;
    const starts: number[] = [];
    await page.route("**/api/metrics/cases*", async (route) => {
      starts.push(Date.now());
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.continue();
      } catch {
        // the page went away while this was pending
      } finally {
        inFlight -= 1;
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(12_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    console.log(`case metrics requests in 12 s: ${starts.length}, max in flight ${maxInFlight}`);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeLessThanOrEqual(5);
    // Strict Mode mounts the poll twice in dev; its first run is aborted at once, so allow that overlap only.
    expect(maxInFlight).toBeLessThanOrEqual(2);
    for (let i = 2; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(2500);
    expect(issues()).toEqual([]);
  });

  test("6. layout with data: 13 cards, no horizontal scroll at 1440, and no added overflow at 390", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    await resolveTwo(page);
    await openOverview(page);
    expect(await cardCount(page)).toBe(13);
    await expect(triageCard(page).getByTestId("analyst-agreement")).toBeVisible();

    const wide = await noHorizontalScroll(page);
    expect(wide.doc, "1440px document").toBeLessThanOrEqual(0);
    expect(wide.scroller, "1440px scroller").toBeLessThanOrEqual(0);

    // The Overview already scrolls sideways on a phone (its Newest incidents grid has fixed
    // columns), with or without these rows. What matters here is that the new rows add none.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    expect(await cardCount(page)).toBe(13);
    const withRows = await noHorizontalScroll(page);
    expect(withRows.doc, "390px document").toBeLessThanOrEqual(0);

    await page.route("**/api/metrics/cases*", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.reload();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByText("Automated response", { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(3500);
    await expect(page.getByTestId("analyst-agreement")).toHaveCount(0);
    const withoutRows = await noHorizontalScroll(page);
    console.log(`390px overflow with the case rows ${withRows.scroller}, without ${withoutRows.scroller}`);
    expect(withRows.scroller).toBeLessThanOrEqual(withoutRows.scroller);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("7. screenshots: the three cards with data (light) and the Open incidents card (dark)", async ({ page }) => {
    const issues = trackIssues(page);
    await resolveTwo(page);

    await openOverview(page, "light");
    await expect(detectionCard(page).getByTestId("analyst-verdicts")).toBeVisible();
    const shots = [
      await shot(openCard(page), "case-metrics-open-incidents-light-1440.png"),
      await shot(triageCard(page), "case-metrics-ai-triage-light-1440.png"),
      await shot(detectionCard(page), "case-metrics-detection-quality-light-1440.png"),
    ];
    for (const size of shots) expectUsable(size);

    await openOverview(page, "dark");
    await expect(openCard(page).getByTestId("case-status-counts")).toBeVisible();
    expectUsable(await shot(openCard(page), "case-metrics-open-incidents-dark-1440.png"));
    expect(issues()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Realistic backend, read only

test.describe("case metrics on the Overview (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("8. the UI numbers equal /api/metrics/cases and nothing is written", async ({ page }) => {
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });

    const api = await metricsCases(page);
    const a = api.ai_agreement.value;
    expect(a.agree).toBeLessThanOrEqual(a.scored);
    expect(a.scored).toBeLessThanOrEqual(a.resolved_total);
    expect(a.agree + a.disagree).toBe(a.scored);
    expect(a.scored + a.ai_uncertain + a.unscored).toBe(a.resolved_total);
    const counts = api.status_counts.value;
    expect(counts.open + counts.investigating + counts.resolved).toBe(8);

    await openOverview(page);
    expect(await cardCount(page)).toBe(13);
    await expect(openCard(page).getByTestId("case-status-counts")).toHaveText(statusTemplate(api));
    await expect(triageCard(page).getByTestId("analyst-agreement-text")).toHaveText(agreementTemplate(api));
    if (api.resolve_time.value.count > 0) {
      await expect(openCard(page).getByTestId("case-median-resolve")).toContainText(`(${api.resolve_time.value.count} resolved)`);
    } else {
      await expect(openCard(page).getByTestId("case-median-resolve")).toHaveCount(0);
    }
    const rules = Object.keys(api.verdicts_by_rule.value);
    await expect(detectionCard(page).getByTestId("analyst-verdict-row")).toHaveCount(Math.min(5, rules.length));

    await page.waitForTimeout(1500);
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
