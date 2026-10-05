import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import { resolveBackendUrl } from "../lib/backendUrl";
import { nextDelay } from "../lib/pollBackoff";

const SHOTS = path.join(__dirname, "screenshots");

test.describe("nextDelay: unit", () => {
  test("no failures gives the base delay", () => {
    expect(nextDelay(0, 3000, 30000)).toBe(3000);
    expect(nextDelay(-1, 3000, 30000)).toBe(3000);
    expect(nextDelay(Number.NaN, 3000, 30000)).toBe(3000);
  });

  test("doubles once per consecutive failure", () => {
    expect(nextDelay(1, 3000, 30000)).toBe(6000);
    expect(nextDelay(2, 3000, 30000)).toBe(12000);
    expect(nextDelay(3, 3000, 30000)).toBe(24000);
  });

  test("is capped at the maximum", () => {
    expect(nextDelay(4, 3000, 30000)).toBe(30000);
    expect(nextDelay(5, 3000, 30000)).toBe(30000);
    expect(nextDelay(10, 3000, 30000)).toBe(30000);
    expect(nextDelay(1000, 3000, 30000)).toBe(30000);
    expect(nextDelay(Number.POSITIVE_INFINITY, 3000, 30000)).toBe(30000);
    expect(nextDelay(2, 3000, 5000)).toBe(5000);
    expect(nextDelay(1, 5000, 30000)).toBe(10000);
  });

  test("the sequence for 0 to 10 failures never decreases", () => {
    const seq = Array.from({ length: 11 }, (_, n) => nextDelay(n, 3000, 30000));
    expect(seq).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]);
  });
});

test.describe("resolveBackendUrl: unit", () => {
  test("production without a value is not ok", () => {
    for (const BACKEND_URL of [undefined, "", "   "]) {
      const r = resolveBackendUrl({ BACKEND_URL, NODE_ENV: "production" });
      expect(r.ok, String(BACKEND_URL)).toBe(false);
      if (!r.ok) expect(r.reason).toContain("BACKEND_URL");
    }
  });

  test("a valid URL is returned without trailing slashes", () => {
    expect(resolveBackendUrl({ BACKEND_URL: "https://api.example.com", NODE_ENV: "production" })).toEqual({
      ok: true,
      url: "https://api.example.com",
    });
    expect(resolveBackendUrl({ BACKEND_URL: "https://api.example.com/", NODE_ENV: "production" })).toEqual({
      ok: true,
      url: "https://api.example.com",
    });
    expect(resolveBackendUrl({ BACKEND_URL: "http://10.0.0.5:8000///", NODE_ENV: "production" })).toEqual({
      ok: true,
      url: "http://10.0.0.5:8000",
    });
    expect(resolveBackendUrl({ BACKEND_URL: "  https://api.example.com/v1/ ", NODE_ENV: "production" })).toEqual({
      ok: true,
      url: "https://api.example.com/v1",
    });
  });

  test("a malformed URL is not ok in every environment", () => {
    for (const NODE_ENV of ["production", "development", undefined]) {
      for (const BACKEND_URL of ["not a url", "localhost:8000", "ftp://example.com", "javascript:alert(1)", "//example.com", "/x"]) {
        const r = resolveBackendUrl({ BACKEND_URL, NODE_ENV });
        expect(r.ok, `${NODE_ENV} ${BACKEND_URL}`).toBe(false);
      }
    }
  });

  test("outside production the default stays localhost:8000", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(resolveBackendUrl({ NODE_ENV })).toEqual({ ok: true, url: "http://localhost:8000" });
      expect(resolveBackendUrl({ BACKEND_URL: "", NODE_ENV })).toEqual({ ok: true, url: "http://localhost:8000" });
    }
  });

  test("a failure reason never contains the value it rejected", () => {
    const r = resolveBackendUrl({ BACKEND_URL: "ftp://user:secret@example.com", NODE_ENV: "production" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
// Browser tests. Every /api call is intercepted so each test controls timing.

const OVERVIEW_CALL = /^\/api\/(metrics\/(summary|timeseries|top|mitre|response|triage|pipeline)|incidents)$/;
const ENDPOINTS_PER_CYCLE = 8;
const BACKEND_UNAVAILABLE = JSON.stringify({ error: "backend_unavailable" });

type Mode = "ok" | "fail" | "slow";

interface Harness {
  setMode(mode: Mode): void;
  /** Start time of each poll cycle. React Strict Mode (dev only) mounts the
   *  effect twice, which fires a second, immediately aborted cycle within a
   *  few milliseconds; starts closer than 400 ms count as one cycle. */
  starts: number[];
  inFlight(): number;
  maxInFlight(): number;
  statusOk: { value: boolean };
}

function trackIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return issues;
}

// A page cycle starts with the summary request. Healthy calls pass through to
// the real backend; failing calls are answered 503 backend_unavailable; slow
// calls wait 15 s first.
async function install(page: Page, initial: Mode): Promise<Harness> {
  let mode: Mode = initial;
  // Requests the handler is holding. A request the page aborts (a superseded
  // run) is dropped from the set when the browser reports it failed.
  const live = new Set<Request>();
  let maxInFlight = 0;
  const starts: number[] = [];
  const statusOk = { value: true };
  page.on("requestfailed", (r) => live.delete(r));

  await page.route(/\/api\//, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/backend-status") {
      await route.fulfill({ json: { ok: statusOk.value } });
      return;
    }
    if (!OVERVIEW_CALL.test(url.pathname)) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/metrics/summary") {
      const now = Date.now();
      if (starts.length === 0 || now - starts[starts.length - 1] > 400) starts.push(now);
    }
    const request = route.request();
    live.add(request);
    maxInFlight = Math.max(maxInFlight, live.size);
    try {
      if (mode === "fail") {
        await route.fulfill({ status: 503, contentType: "application/json", body: BACKEND_UNAVAILABLE });
      } else if (mode === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        await route.continue();
      } else {
        await route.continue();
      }
    } catch {
      // the page went away while this call was pending
    } finally {
      live.delete(request);
    }
  });

  return {
    setMode: (m) => {
      mode = m;
    },
    starts,
    inFlight: () => live.size,
    maxInFlight: () => maxInFlight,
    statusOk,
  };
}

// The first request to each route compiles it in dev mode; do that before
// timing anything.
test.beforeAll(async ({ request }) => {
  for (const url of [
    "/api/metrics/summary?range=7d",
    "/api/metrics/timeseries?range=7d",
    "/api/metrics/top?range=7d",
    "/api/metrics/mitre?range=7d",
    "/api/metrics/response?range=7d",
    "/api/metrics/triage?range=7d",
    "/api/metrics/pipeline",
    "/api/incidents?limit=5",
    "/api/backend-status",
    // also in each poll cycle now; the first cycle's length includes compiling them
    "/api/cases",
    "/api/metrics/cases?range=7d",
  ]) {
    await request.get(url);
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const secs = (ms: number) => Math.round(ms / 100) / 10;

test.describe("overview poll: resilience", () => {
  test("slow backend: no overlapping runs, in-flight requests never exceed one cycle", async ({ page }) => {
    test.setTimeout(90_000);
    const h = await install(page, "slow");
    const issues = trackIssues(page);
    await page.goto("/");

    const samples: number[] = [];
    const began = Date.now();
    while (Date.now() - began < 20_000) {
      samples.push(h.inFlight());
      await sleep(250);
    }
    console.log(`in-flight /api samples (every 250 ms for 20 s): ${samples.join(",")}`);
    console.log(`max in flight: ${h.maxInFlight()}, cycles started: ${h.starts.length}`);

    // The sampled count is the assertion. The recorded peak can briefly read 16
    // in dev when Strict Mode's aborted first run overlaps in the handler.
    expect(Math.max(...samples)).toBe(ENDPOINTS_PER_CYCLE);
    // Each cycle takes 15 s. The second may start about 3 s after the first
    // finishes (around 18 s) but never while the first is still running, which
    // would show up as 16 requests in flight.
    expect(h.starts.length).toBeGreaterThanOrEqual(1);
    expect(h.starts.length).toBeLessThanOrEqual(2);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues).toEqual([]);
  });

  test("failing backend: gaps grow 3, 6, 12, 24, never pass 30 s, and recovery returns to 3 s", async ({ page }) => {
    test.setTimeout(180_000);
    const h = await install(page, "ok");
    await page.goto("/");

    // First cycle succeeds, then the backend starts answering 503.
    await expect.poll(() => h.starts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await sleep(800);
    h.setMode("fail");

    const began = h.starts[0];
    while (Date.now() - began < 50_000) await sleep(500);

    const gaps = h.starts.slice(1).map((t, i) => t - h.starts[i]);
    console.log(`cycle starts (s since first): ${h.starts.map((t) => secs(t - began)).join(", ")}`);
    console.log(`gaps (s): ${gaps.map(secs).join(", ")}`);
    const expected = [3000, 6000, 12000, 24000];
    expect(gaps.length).toBeGreaterThanOrEqual(expected.length);
    expected.forEach((want, i) => {
      // Each gap is the time between the START of one poll cycle and the start of
      // the next, taken from request timestamps in this process. It is still a
      // wall-clock measure: when several workers share the CPU, the dev server and
      // the browser can stall a timer or a request for a second or more, so a
      // tight band flakes. 35 percent plus 1000 ms keeps the doubling visible
      // (3, 6, 12, 24 s are far apart relative to the margin, and the gaps must
      // still strictly increase) without failing on scheduling noise.
      const slack = want * 0.35 + 1000;
      expect(gaps[i], `gap ${i + 1}`).toBeGreaterThanOrEqual(want - slack);
      expect(gaps[i], `gap ${i + 1}`).toBeLessThanOrEqual(want + slack);
    });
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(30_000 * 1.2);
    for (let i = 1; i < 4; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);

    // Backend comes back. The pending delay is at most 30 s.
    const lastStart = h.starts[h.starts.length - 1];
    const startsBefore = h.starts.length;
    h.setMode("ok");
    await expect.poll(() => h.starts.length, { timeout: 40_000 }).toBeGreaterThan(startsBefore);
    const recoveryStart = h.starts[startsBefore];
    console.log(`recovery cycle started ${secs(recoveryStart - lastStart)} s after the previous one`);
    expect(recoveryStart - lastStart).toBeLessThanOrEqual(30_000 * 1.2 + 500);

    await expect.poll(() => h.starts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(startsBefore + 3);
    const recovered = h.starts.slice(startsBefore);
    const after = recovered.slice(1).map((t, i) => t - recovered[i]);
    console.log(`gaps after recovery (s): ${after.map(secs).join(", ")}`);
    for (const gap of after.slice(0, 2)) {
      expect(gap).toBeGreaterThanOrEqual(3000 - 600);
      expect(gap).toBeLessThanOrEqual(3000 + 1500);
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("healthy backend keeps the 3 second cadence", async ({ page }) => {
    test.setTimeout(60_000);
    const h = await install(page, "ok");
    const issues = trackIssues(page);
    await page.goto("/");
    await expect.poll(() => h.starts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const began = h.starts[0];
    await sleep(12_000);
    const inWindow = h.starts.filter((t) => t - began <= 12_000);
    console.log(`healthy: ${inWindow.length} cycles in 12 s, starts (s): ${inWindow.map((t) => secs(t - began)).join(", ")}`);
    expect(inWindow.length).toBeGreaterThanOrEqual(3);
    expect(inWindow.length).toBeLessThanOrEqual(5);
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues).toEqual([]);
  });

  test("a hidden tab starts no new cycles and a visible tab starts one at once", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __hidden: boolean };
      w.__hidden = false;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => w.__hidden });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (w.__hidden ? "hidden" : "visible"),
      });
    });
    const h = await install(page, "ok");
    const issues = trackIssues(page);
    await page.goto("/");
    await expect.poll(() => h.starts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    await page.evaluate(() => {
      (window as unknown as { __hidden: boolean }).__hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(1_500); // lets a run that was already in flight finish
    const frozen = h.starts.length;
    await sleep(10_000); // more than three polling periods
    console.log(`hidden: cycles before ${frozen}, after 10 s ${h.starts.length}`);
    expect(h.starts.length).toBe(frozen);

    const shown = Date.now();
    await page.evaluate(() => {
      (window as unknown as { __hidden: boolean }).__hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => h.starts.length, { timeout: 2_500 }).toBe(frozen + 1);
    console.log(`visible again: new cycle after ${Date.now() - shown} ms`);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues).toEqual([]);
  });

  test("polling stops after leaving the Overview", async ({ page }) => {
    test.setTimeout(60_000);
    const h = await install(page, "ok");
    await page.goto("/");
    await expect.poll(() => h.starts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await page.getByRole("link", { name: "Alerts" }).first().click();
    await page.waitForURL("**/alerts");
    await sleep(1_000);
    const frozen = h.starts.length;
    await sleep(8_000);
    expect(h.starts.length).toBe(frozen);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("503 period shows the wake banner (screenshot, light)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    const issues = trackIssues(page);
    const h = await install(page, "fail");
    h.statusOk.value = false;
    await page.goto("/");

    const banner = page.getByRole("status").filter({ hasText: "The demo backend is waking up" });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Could not reach the backend.")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);

    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, "poll-503-wake-banner-light-1440.png");
    await page.screenshot({ path: file });
    const buf = fs.readFileSync(file);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    console.log(`${path.basename(file)} ${width}x${height}`);
    expect(width).toBe(1440);
    expect(height).toBe(900);

    // and the banner goes away once the backend answers again
    h.statusOk.value = true;
    h.setMode("ok");
    await expect(banner).toBeHidden({ timeout: 40_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    // Chromium itself logs one "Failed to load resource ... 503" console error
    // for every 503 answer; that is the stimulus here, not an app message. This
    // is the only test that tolerates those lines (nothing else is filtered).
    const browserNetworkLines = issues.filter((i) =>
      /^error: Failed to load resource: the server responded with a status of 503 /.test(i),
    );
    console.log(`503 period: ${browserNetworkLines.length} browser network lines, ${issues.length - browserNetworkLines.length} other issues`);
    expect(issues.filter((i) => !browserNetworkLines.includes(i))).toEqual([]);
  });
});
