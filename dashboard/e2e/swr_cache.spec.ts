import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { createCache, shareStructure } from "../lib/swrCache";
import { E2E_DATA_ROOT } from "../playwright.config";

// Step 14c: a stale-while-revalidate cache for the client pages. A revisit shows the
// last data at once, refreshes it in the background and changes only what changed.

const REALISTIC = Boolean(process.env.E2E_REALISTIC);
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CASES_FILE = path.join(E2E_DATA_ROOT, "cases.json");
const SHOTS = path.join(__dirname, "screenshots");

// All case spec files share one cases.json in the temp DATA_ROOT, and Playwright
// runs spec files in parallel workers. This describe holds a lock folder from its
// beforeAll to its afterAll so the case specs take turns.
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
// Pure tests: shareStructure

test.describe("shareStructure: unit", () => {
  test("equal values return the same reference", () => {
    const prev = { a: [1, { b: 2 }], c: { d: null, e: "x" }, f: [] as number[] };
    const next = JSON.parse(JSON.stringify(prev)) as typeof prev;
    expect(next).not.toBe(prev);
    expect(shareStructure(prev, next)).toBe(prev);
    const list = [{ id: 1 }, { id: 2 }];
    expect(shareStructure(list, [{ id: 1 }, { id: 2 }])).toBe(list);
    expect(shareStructure([], [])).toEqual([]);
  });

  test("a changed leaf changes only the objects on its path", () => {
    const prev = { a: { x: 1, y: { z: 1 } }, b: { k: [1, 2] }, list: [{ id: 1 }, { id: 2 }] };
    const next = { a: { x: 1, y: { z: 2 } }, b: { k: [1, 2] }, list: [{ id: 1 }, { id: 2 }] };
    const out = shareStructure(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual(next);
    expect(out.a).not.toBe(prev.a);
    expect(out.a.y).not.toBe(prev.a.y);
    expect(out.b).toBe(prev.b);
    expect(out.list).toBe(prev.list);
    expect(out.list[0]).toBe(prev.list[0]);
  });

  test("an appended array element keeps every earlier element", () => {
    const o1 = { id: 1, v: "a" };
    const o2 = { id: 2, v: "b" };
    const prev = [o1, o2];
    const added = { id: 3, v: "c" };
    const out = shareStructure(prev, [{ ...o1 }, { ...o2 }, added]);
    expect(out).not.toBe(prev);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(o1);
    expect(out[1]).toBe(o2);
    expect(out[2]).toBe(added);
  });

  test("a removed element: the rest keep their identity", () => {
    const prev = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const out = shareStructure(prev, [{ id: 1 }, { id: 2 }]);
    expect(out).not.toBe(prev);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    // emptied and refilled
    expect(shareStructure(prev, [])).toEqual([]);
    const refilled = shareStructure([], prev);
    expect(refilled).toEqual(prev);
    expect(refilled[0]).toBe(prev[0]);
  });

  test("a changed element keeps its untouched siblings", () => {
    const prev = [{ id: 1, s: "open" }, { id: 2, s: "open" }, { id: 3, s: "open" }];
    const out = shareStructure(prev, [{ id: 1, s: "open" }, { id: 2, s: "done" }, { id: 3, s: "open" }]);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out[1]).toEqual({ id: 2, s: "done" });
    expect(out[2]).toBe(prev[2]);
  });

  test("key order does not matter", () => {
    const prev = { a: 1, b: { c: 2, d: [1, 2] } };
    expect(shareStructure(prev, { b: { d: [1, 2], c: 2 }, a: 1 })).toBe(prev);
    expect(shareStructure(prev, { b: { d: [1, 2], c: 3 }, a: 1 })).not.toBe(prev);
  });

  test("null and undefined", () => {
    expect(shareStructure(null, null)).toBeNull();
    expect(shareStructure(undefined, undefined)).toBeUndefined();
    expect(shareStructure(null, { a: 1 })).toEqual({ a: 1 });
    expect(shareStructure({ a: 1 }, null)).toBeNull();
    expect(shareStructure(undefined, [1])).toEqual([1]);
    const withNull = { a: null, b: [null] };
    expect(shareStructure(withNull, { a: null, b: [null] })).toBe(withNull);
    const prev = { a: 1 };
    expect(shareStructure(prev, { a: 1, b: undefined })).not.toBe(prev); // an extra key
    expect(shareStructure({ a: undefined }, { a: undefined })).toEqual({ a: undefined });
  });

  test("primitives", () => {
    expect(shareStructure(1, 1)).toBe(1);
    expect(shareStructure(1, 2)).toBe(2);
    expect(shareStructure("a", "b")).toBe("b");
    expect(shareStructure("a", "a")).toBe("a");
    expect(shareStructure(true, false)).toBe(false);
    expect(shareStructure(1, "1")).toBe("1");
    expect(shareStructure({ a: 1 }, 5)).toBe(5);
    expect(shareStructure(5, { a: 1 })).toEqual({ a: 1 });
  });

  test("arrays and objects are never mixed up", () => {
    expect(shareStructure([1], { 0: 1 })).toEqual({ 0: 1 });
    expect(Array.isArray(shareStructure({ 0: 1 }, [1]))).toBe(true);
    expect(shareStructure([], {})).toEqual({});
    expect(Array.isArray(shareStructure({}, []))).toBe(true);
    const prev = { list: [1, 2] };
    const out = shareStructure(prev, { list: { 0: 1, 1: 2 } });
    expect(Array.isArray(out.list)).toBe(false);
  });

  test("the depth cap: values past 50 levels return the new value, nothing throws", () => {
    const nest = (depth: number, leaf: unknown): unknown => {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i++) v = { a: v };
      return v;
    };
    const shallowPrev = nest(40, 1);
    expect(shareStructure(shallowPrev, nest(40, 1))).toBe(shallowPrev);
    const deepPrev = nest(60, 1);
    const deepNext = nest(60, 1);
    let out: unknown;
    expect(() => {
      out = shareStructure(deepPrev, deepNext);
    }).not.toThrow();
    expect(out).toEqual(deepNext);
    // very deep (far past the stack of a naive recursion)
    const veryDeepNext = nest(20_000, 2);
    expect(() => shareStructure(nest(20_000, 1), veryDeepNext)).not.toThrow();
  });

  test("garbage never throws", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const cyclic2: Record<string, unknown> = { a: 1 };
    cyclic2.self = cyclic2;
    const throwing = {
      get x(): number {
        throw new Error("boom");
      },
    };
    const sparse = new Array(5);
    const garbage: unknown[] = [
      undefined,
      null,
      NaN,
      Infinity,
      -0,
      0,
      "",
      Symbol("s"),
      BigInt(5),
      () => 1,
      new Date(0),
      new Map([[1, 2]]),
      new Set([1]),
      /re/,
      new Error("e"),
      Object.create(null),
      Object.create({ inherited: 1 }),
      sparse,
      cyclic,
      throwing,
      new (class Thing {
        v = 1;
      })(),
      new Array(1000).fill({ a: 1 }),
    ];
    for (let i = 0; i < garbage.length; i++) {
      for (let j = 0; j < garbage.length; j++) {
        expect(() => shareStructure(garbage[i], garbage[j]), `garbage ${i} vs garbage ${j}`).not.toThrow();
      }
    }
    expect(() => shareStructure(cyclic, cyclic2)).not.toThrow();
    // a value that is not JSON is returned as it is
    const d = new Date(5);
    expect(shareStructure(new Date(5), d)).toBe(d);
  });
});

// ---------------------------------------------------------------------------
// Pure tests: createCache

test.describe("createCache: unit", () => {
  test("a set and get round trip; equal data keeps the stored reference", () => {
    const cache = createCache();
    const first = cache.set("k", { a: [1, 2], b: { c: 3 } });
    expect(cache.get("k")?.data).toBe(first);
    const again = cache.set("k", { a: [1, 2], b: { c: 3 } });
    expect(again).toBe(first);
    expect(cache.get("k")?.data).toBe(first);
    const changed = cache.set("k", { a: [1, 2], b: { c: 4 } });
    expect(changed).not.toBe(first);
    expect(changed.a).toBe(first.a);
    expect(cache.get("k")?.data).toBe(changed);
    expect(cache.get("nope")).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  test("fetchedAt is the given time, or the clock's", () => {
    let t = 1000;
    const cache = createCache({ now: () => t });
    cache.set("a", 1);
    expect(cache.get("a")?.fetchedAt).toBe(1000);
    t = 5000;
    cache.set("b", 2, 4000);
    expect(cache.get("b")?.fetchedAt).toBe(4000);
    cache.set("a", 1);
    expect(cache.get("a")?.fetchedAt).toBe(5000);
  });

  test("max age: an entry older than the limit is gone and is removed", () => {
    let t = 0;
    const cache = createCache({ now: () => t, maxAgeMs: 10 * 60_000 });
    cache.set("k", { v: 1 });
    t = 10 * 60_000;
    expect(cache.get("k")).toBeDefined(); // exactly at the limit is still fresh
    t = 10 * 60_000 + 1;
    expect(cache.size()).toBe(1);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0); // the expired entry was removed
    // the default limit is ten minutes
    const d = createCache({ now: () => t });
    t = 0;
    d.set("x", 1);
    t = 600_000;
    expect(d.get("x")).toBeDefined();
    t = 600_001;
    expect(d.get("x")).toBeUndefined();
  });

  test("max entries: the oldest entry goes first", () => {
    const cache = createCache({ maxEntries: 3 });
    for (const k of ["a", "b", "c", "d"]) cache.set(k, k);
    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(["b", "c", "d"].every((k) => cache.get(k) !== undefined)).toBe(true);
    // rewriting b makes it the newest, so c is the next to go
    cache.set("b", "b2");
    cache.set("e", "e");
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("b")?.data).toBe("b2");
    expect(cache.get("d")).toBeDefined();
    expect(cache.get("e")).toBeDefined();
    // the default holds 100
    const big = createCache();
    for (let i = 0; i < 150; i++) big.set(`k${i}`, i);
    expect(big.size()).toBe(100);
    expect(big.get("k0")).toBeUndefined();
    expect(big.get("k149")).toBeDefined();
    // none at all keeps nothing
    const none = createCache({ maxEntries: 0 });
    none.set("a", 1);
    expect(none.size()).toBe(0);
  });

  test("patch applies the updater, keeps fetchedAt, and does nothing when absent", () => {
    let t = 9000;
    const cache = createCache({ now: () => t });
    cache.set("list", [{ id: 1 }, { id: 2 }], 1000);
    const out = cache.patch<{ id: number }[]>("list", (l) => [...l, { id: 3 }]);
    expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(cache.get("list")?.fetchedAt).toBe(1000);
    expect(cache.get("list")?.data).toBe(out);
    // earlier elements keep their identity
    const before = cache.get<{ id: number }[]>("list")!.data;
    const after = cache.patch<{ id: number }[]>("list", (l) => l.map((x) => ({ ...x })));
    expect(after).toBe(before);
    // absent: nothing happens, nothing is created
    expect(cache.patch("missing", () => 1)).toBeUndefined();
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.size()).toBe(1);
    // an expired entry counts as absent
    t = 1000 + 10 * 60_000 + 1;
    expect(cache.patch("list", () => [])).toBeUndefined();
  });

  test("delete, deletePrefix and clear", () => {
    const cache = createCache();
    cache.set("a:1", 1);
    cache.set("a:2", 2);
    cache.set("b:1", 3);
    cache.delete("a:1");
    expect(cache.get("a:1")).toBeUndefined();
    cache.deletePrefix("a:");
    expect(cache.size()).toBe(1);
    expect(cache.get("b:1")).toBeDefined();
    cache.set("c", 1);
    cache.clear();
    expect(cache.size()).toBe(0);
    cache.deletePrefix("");
    cache.delete("never");
    expect(cache.size()).toBe(0);
  });

  test("keys must be non-empty strings; anything else is ignored", () => {
    const cache = createCache();
    for (const bad of ["", 5, null, undefined, {}, [], true]) {
      expect(() => cache.set(bad as never, 1)).not.toThrow();
      expect(cache.get(bad as never)).toBeUndefined();
      expect(() => cache.delete(bad as never)).not.toThrow();
      expect(cache.patch(bad as never, () => 1)).toBeUndefined();
    }
    expect(() => cache.deletePrefix(5 as never)).not.toThrow();
    expect(() => cache.deletePrefix(null as never)).not.toThrow();
    expect(cache.size()).toBe(0);
    // set with a bad key still hands the data back
    const data = { a: 1 };
    expect(cache.set("", data)).toBe(data);
  });
});

// ---------------------------------------------------------------------------
// Browser helpers

function trackIssues(page: Page, tolerateStatus: number[] = []): () => string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    // Chromium itself logs one line per 4xx or 5xx answer; that is the stimulus in a
    // test that mocks one, not an app message. Nothing else is filtered.
    const m = /^Failed to load resource: the server responded with a status of (\d+) /.exec(text);
    if (m && tolerateStatus.includes(Number(m[1]))) return;
    issues.push(`${msg.type()}: ${text}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return () => issues;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Saved before any assertion about the picture, so a failing run still leaves it to look at.
async function shot(target: Locator | Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await target.screenshot({ path: file });
  const size = pngSize(file);
  console.log(`${name} ${size.width}x${size.height}`);
  return size;
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

const DELAY_MS = 2500;

// Every /api/** answer waits first, so what is on screen before the answers arrive is
// exactly what the cache gave the page.
async function delayApi(page: Page, ms = DELAY_MS, only?: (pathname: string) => boolean) {
  await page.route(
    (url) => url.pathname.startsWith("/api/") && (only ? only(url.pathname) : true),
    async (route) => {
      await sleep(ms);
      try {
        await route.continue();
      } catch {
        // the page moved on while this answer was pending
      }
    },
  );
}

type NavName = "Overview" | "Incidents" | "Alerts";

// A client-side navigation through the sidebar, so the page's JavaScript (and the
// cache in it) stays alive.
async function nav(page: Page, name: NavName) {
  await page.locator("aside nav").getByRole("link", { name, exact: true }).first().click();
  const want = name === "Overview" ? "/" : `/${name.toLowerCase()}`;
  await page.waitForURL((u) => u.pathname === want);
}

const cardsText = async (page: Page) => (await page.getByTestId("overview-card").allInnerTexts()).join("\n---\n");
const updatedText = (page: Page) => page.getByText(/^Updated \d{2}:\d{2}:\d{2}/);
const incidentRows = (page: Page) => page.locator("tbody tr[data-incident-id]");
const alertRows = (page: Page) => page.locator("tbody tr").filter({ has: page.locator("td:nth-child(6)") });

async function waitOverviewLoaded(page: Page) {
  await expect(updatedText(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("overview-card")).toHaveCount(13);
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

// Milliseconds from just before the click to the first frame in which `done` holds
// (checked on every animation frame in the page).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function timeUntil(page: Page, click: () => Promise<void>, done: (arg: any) => boolean, arg: string | number): Promise<number> {
  const started = Date.now();
  await click();
  await page.waitForFunction(done, arg, { polling: "raf", timeout: 5_000 });
  return Date.now() - started;
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("div.h-screen.min-w-0.flex-1.overflow-y-auto");
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
    };
  });
}

const cacheSize = (page: Page) =>
  page.evaluate(() => {
    const cache = (globalThis as unknown as { __csaSwrCache?: { size(): number } }).__csaSwrCache;
    return cache ? cache.size() : -1;
  });

let ipCounter = 0;
async function signIn(page: Page) {
  ipCounter += 1;
  const res = await page.request.post("/api/auth/login", {
    data: { password: PASSWORD },
    headers: { "x-forwarded-for": `198.51.100.${((Date.now() + ipCounter * 31) % 250) + 1}, 10.1.${ipCounter % 250}.1` },
  });
  expect(res.status()).toBe(200);
}

// ---------------------------------------------------------------------------
// Default backend, temp DATA_ROOT

test.describe("stale-while-revalidate cache (default backend, temp DATA_ROOT)", () => {
  test.skip(REALISTIC, "these tests run only against the default backend");

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

  test("1. a revisit renders from the cache at once, shows Refreshing, then settles", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // first visits, nothing delayed
    await page.goto("/");
    await waitOverviewLoaded(page);
    const overviewBefore = await cardsText(page);
    const updatedBefore = (await updatedText(page).innerText()).trim();

    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const incidentCount = await incidentRows(page).count();
    expect(incidentCount).toBeGreaterThan(0);

    await nav(page, "Alerts");
    await expect(alertRows(page).first()).toBeVisible({ timeout: 15_000 });
    const alertCount = await alertRows(page).count();
    expect(alertCount).toBeGreaterThan(0);

    // from here every /api answer takes 2.5 s
    await delayApi(page);

    // Overview
    const overviewMs = await timeUntil(
      page,
      () => nav(page, "Overview"),
      (expected: string) => {
        const cards = Array.from(document.querySelectorAll('[data-testid="overview-card"]')) as HTMLElement[];
        return (
          cards.length > 0 &&
          cards.map((c) => c.innerText).join("\n---\n") === expected &&
          !document.body.innerText.includes("Loading…")
        );
      },
      overviewBefore,
    );
    console.log(`TIMING overview revisit: cards populated ${overviewMs} ms after the click`);
    expect(overviewMs).toBeLessThan(300);
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    // the Updated line is the cached entry's time, not the current time
    expect((await updatedText(page).innerText()).trim()).toBe(updatedBefore);
    // the answers arrive after 2.5 s and the note goes away
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });
    await expect(updatedText(page)).not.toHaveText(updatedBefore);
    expect(await cardsText(page)).toBe(overviewBefore);

    // Incidents list
    const listMs = await timeUntil(
      page,
      () => nav(page, "Incidents"),
      (n: number) => document.querySelectorAll("tbody tr[data-incident-id]").length === n,
      incidentCount,
    );
    console.log(`TIMING incidents revisit: ${incidentCount} rows present ${listMs} ms after the click`);
    expect(listMs).toBeLessThan(300);
    await expect(page.getByText("No incidents match the selected filters.")).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });
    await expect(incidentRows(page)).toHaveCount(incidentCount);

    // Alerts list
    const alertsMs = await timeUntil(
      page,
      () => nav(page, "Alerts"),
      (n: number) => document.querySelectorAll("tbody tr td:nth-child(6)").length === n,
      alertCount,
    );
    console.log(`TIMING alerts revisit: ${alertCount} rows present ${alertsMs} ms after the click`);
    expect(alertsMs).toBeLessThan(300);
    await expect(page.getByText("No alerts.")).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });
    await expect(alertRows(page)).toHaveCount(alertCount);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("2. a first visit still shows the loading state", async ({ page }) => {
    test.setTimeout(60_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await delayApi(page);

    await page.goto("/");
    await expect(page.getByText("Loading…").first()).toBeVisible();
    await expect(updatedText(page)).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("");
    await expect(updatedText(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Loading…")).toHaveCount(0);

    // a list opened for the first time has no rows until its answer arrives
    await nav(page, "Incidents");
    await expect(incidentRows(page)).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("3. a revalidation merges: kept rows stay the same elements, one is added, only the changed row updates", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    // a cached visit: Overview and back
    await nav(page, "Overview");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });
    const before = await incidentRows(page).count();
    expect(before).toBeGreaterThanOrEqual(3);
    const idsBefore = await incidentRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-incident-id") ?? ""));
    const changedId = idsBefore.includes("inc-0002") ? "inc-0002" : idsBefore[0];

    // mark every row element, then watch the table body
    await page.evaluate(() => {
      document.querySelectorAll("tbody tr[data-incident-id]").forEach((tr) => {
        (tr as unknown as { __kept: boolean }).__kept = true;
      });
      const w = window as unknown as { __muts: { added: string[]; removed: string[]; touched: string[] } };
      w.__muts = { added: [], removed: [], touched: [] };
      const tbody = document.querySelector("tbody")!;
      const idOf = (n: Node | null): string | null => {
        const el = n instanceof Element ? n : n?.parentElement ?? null;
        return el?.closest("tr[data-incident-id]")?.getAttribute("data-incident-id") ?? null;
      };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "childList" && r.target === tbody) {
            r.addedNodes.forEach((n) => {
              const id = n instanceof Element ? n.getAttribute("data-incident-id") : null;
              if (id) w.__muts.added.push(id);
            });
            r.removedNodes.forEach((n) => {
              const id = n instanceof Element ? n.getAttribute("data-incident-id") : null;
              if (id) w.__muts.removed.push(id);
            });
          } else {
            const id = idOf(r.target);
            if (id) w.__muts.touched.push(id);
          }
        }
      }).observe(tbody, { childList: true, subtree: true, characterData: true, attributes: true });
    });

    // the next answer brings one more incident and a changed case status for another
    const newId = "inc-0099";
    await page.route(
      (url) => url.pathname === "/api/incidents",
      async (route) => {
        const res = await route.fetch();
        const list = (await res.json()) as Record<string, unknown>[];
        list.push({ ...list[0], incident_id: newId, incident_raised_time: "2020-01-01T00:00:00.000Z", host: "WS99" });
        await route.fulfill({ response: res, json: list });
      },
    );
    await page.route(
      (url) => url.pathname === "/api/cases",
      async (route) => {
        const res = await route.fetch();
        const list = ((await res.json()) as Record<string, unknown>[]).filter((c) => c.incident_id !== changedId);
        list.push({
          incident_id: changedId, status: "investigating", assignee: "Analyst 1", verdict: null,
          updated_time: "2026-10-04T10:00:00.000Z", resolved_time: null, version: 2,
        });
        await route.fulfill({ response: res, json: list });
      },
    );

    await expect(incidentRows(page)).toHaveCount(before + 1, { timeout: 15_000 });
    await expect(page.locator(`tbody tr[data-incident-id="${changedId}"] [data-testid="cell-status"]`)).toHaveText("Investigating");
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const w = window as unknown as { __muts: { added: string[]; removed: string[]; touched: string[] } };
      const rows = Array.from(document.querySelectorAll("tbody tr[data-incident-id]"));
      return {
        total: rows.length,
        kept: rows.filter((r) => (r as unknown as { __kept?: boolean }).__kept === true).length,
        added: w.__muts.added,
        removed: w.__muts.removed,
        touched: Array.from(new Set(w.__muts.touched)),
      };
    });
    console.log(`merge: rows ${result.total}, kept elements ${result.kept}, added ${JSON.stringify(result.added)}, removed ${JSON.stringify(result.removed)}, touched ${JSON.stringify(result.touched)}`);
    expect(result.total).toBe(before + 1);
    expect(result.kept).toBe(before); // every original row element is still the same element
    expect(result.added).toEqual([newId]); // exactly one added row element
    expect(result.removed).toEqual([]); // and none removed
    expect(result.touched.filter((id) => id !== newId)).toEqual([changedId]); // only the changed row updated
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("4. an identical revalidation changes nothing in the table", async ({ page }) => {
    test.setTimeout(60_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await nav(page, "Overview");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents"); // a cached visit
    await expect(incidentRows(page).first()).toBeVisible();
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });

    let polls = 0;
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === "/api/incidents") polls += 1;
    });
    await page.evaluate(() => {
      const w = window as unknown as { __tableMuts: { childList: number; rowChanges: number } };
      w.__tableMuts = { childList: 0, rowChanges: 0 };
      const container = document.querySelector('[data-testid="incidents-table-container"]')!;
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "childList") w.__tableMuts.childList += 1;
          else w.__tableMuts.rowChanges += 1; // characterData or attributes
        }
      }).observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
    });
    await page.waitForTimeout(5000);
    const muts = await page.evaluate(() => (window as unknown as { __tableMuts: { childList: number; rowChanges: number } }).__tableMuts);
    console.log(`identical revalidation: ${polls} incident polls in 5 s, mutations ${JSON.stringify(muts)}`);
    expect(polls).toBeGreaterThanOrEqual(1); // the window really contained a revalidation
    expect(muts.childList).toBe(0);
    expect(muts.rowChanges).toBe(0);
    expect(issues()).toEqual([]);
  });

  test("5. each range has its own cache entry", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/"); // 7d is the default range
    await waitOverviewLoaded(page);
    const text7d = await cardsText(page);
    await delayApi(page);

    // 24h has never been opened: its loading state shows
    await page.getByTestId("overview-range").getByRole("button", { name: "24h", exact: true }).click();
    await expect(page.getByText("Loading…").first()).toBeVisible();
    await expect(page.getByTestId("refresh-indicator")).toHaveText("");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 15_000 });
    const text24h = await cardsText(page);

    // back to 7d: its cached numbers at once
    await page.getByTestId("overview-range").getByRole("button", { name: "7d", exact: true }).click();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    expect(await cardsText(page)).toBe(text7d);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });

    // and 24h again, also at once
    await page.getByTestId("overview-range").getByRole("button", { name: "24h", exact: true }).click();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    expect(await cardsText(page)).toBe(text24h);

    // "All" has real numbers in these fixtures (the fixtures predate the clock, so 7d and
    // 24h are empty); its numbers come back from the cache just the same
    const range = page.getByTestId("overview-range");
    await range.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("Loading…").first()).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 15_000 });
    const textAll = await cardsText(page);
    expect(textAll).not.toBe(text7d);
    await range.getByRole("button", { name: "7d", exact: true }).click();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    expect(await cardsText(page)).toBe(text7d);
    await range.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    expect(await cardsText(page)).toBe(textAll);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("6. cached data older than ten minutes is not shown", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.install({ time: new Date() });
    await page.goto("/");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    // leave the list first, so nothing is polling (and refreshing its entry) while time jumps
    await nav(page, "Alerts");
    await expect(alertRows(page).first()).toBeVisible({ timeout: 15_000 });

    await page.clock.fastForward("11:00"); // eleven minutes
    await delayApi(page);
    await nav(page, "Overview");
    await expect(page.getByText("Loading…").first()).toBeVisible();
    await expect(updatedText(page)).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("");
    await expect(updatedText(page)).toBeVisible({ timeout: 15_000 });

    await nav(page, "Incidents");
    // the list's own entry expired too: no rows until the (delayed) answer arrives
    await expect(incidentRows(page)).toHaveCount(0);
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("7. when a refresh fails the cached data stays, with a quiet note and no error banner", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page, [503]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.clock.install({ time: new Date() });
    await page.goto("/");
    await waitOverviewLoaded(page);
    const before = await cardsText(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await nav(page, "Overview"); // a cached visit
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });

    // from now on the backend answers 503 to everything
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.waitForTimeout(1500);
    // less than two poll intervals old: no note yet
    await expect(page.getByText(/Couldn't refresh/)).toHaveCount(0);

    // two poll intervals and more (and the wake check, which runs once a minute)
    await page.clock.fastForward("01:01");
    await expect(page.getByText(/^Couldn't refresh\. Showing data from \d{2}:\d{2}:\d{2} /)).toBeVisible({ timeout: 15_000 });
    expect(await cardsText(page)).toBe(before); // the cached data is still on screen
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0); // no error banner
    await expect(page.getByRole("status").filter({ hasText: "The demo backend is waking up" })).toBeVisible({ timeout: 15_000 });
    expectUsable(await shot(page, "swr-failure-note-light-1440.png"));

    // the list keeps its rows and gets the same note
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible();
    await page.clock.fastForward("00:10");
    await expect(page.getByText(/^Couldn't refresh\. Showing data from /)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("8. a saved change shows in the list at once on the next visit", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tbody tr[data-incident-id="inc-0005"] [data-testid="cell-status"]')).toHaveText("Open");
    await page.waitForLoadState("networkidle");

    // open the incident, assign it and resolve it through the case card
    await page.locator('tbody tr[data-incident-id="inc-0005"]').click();
    await page.waitForURL("**/incidents/inc-0005");
    const card = page.getByTestId("case-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 20_000 });
    await card.getByLabel("Assignee").selectOption("Analyst 1");
    await expect(card.getByLabel("Assignee")).toHaveValue("Analyst 1");
    await card.getByRole("button", { name: "Resolve", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "True positive" }).check();
    await dialog.getByRole("button", { name: "Resolve case" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "resolved");

    // back to the list with slow answers: it must never show Open for inc-0005
    await delayApi(page, DELAY_MS, (p) => p === "/api/incidents" || p === "/api/cases");
    await nav(page, "Incidents");
    const statuses: (string | null)[] = [];
    const assignees: (string | null)[] = [];
    const began = Date.now();
    while (Date.now() - began < 1500) {
      const sample = await page.evaluate(() => {
        const row = document.querySelector('tbody tr[data-incident-id="inc-0005"]');
        return row
          ? {
              status: row.querySelector('[data-testid="cell-status"]')?.textContent?.trim() ?? null,
              assignee: row.querySelector('[data-testid="cell-assignee"]')?.textContent?.trim() ?? null,
            }
          : null;
      });
      statuses.push(sample ? sample.status : null);
      assignees.push(sample ? sample.assignee : null);
      await sleep(50);
    }
    console.log(`first frames, inc-0005 status: ${statuses.join(",")}`);
    console.log(`first frames, inc-0005 assignee: ${assignees.join(",")}`);
    const seen = statuses.filter((s) => s !== null);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen).not.toContain("Open");
    expect(seen.every((s) => s === "Resolved")).toBe(true);
    expect(assignees.filter((a) => a !== null).every((a) => a === "Analyst 1")).toBe(true);
    await expect(page.locator('tbody tr[data-incident-id="inc-0005"] [data-testid="cell-status"]')).toHaveText("Resolved");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("9. signing out clears the cache; the next sign in starts with the loading state", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    expect(await cacheSize(page)).toBeGreaterThan(0);

    // Hold the sign-out request (the session is still valid meanwhile) and slow every other
    // answer, so the old page is alive and nothing can refill its cache while we look at it.
    await delayApi(page, 4000, (p) => !p.startsWith("/api/auth/"));
    await page.route(
      (url) => url.pathname === "/api/auth/logout",
      async (route) => {
        await sleep(1500);
        try {
          await route.continue();
        } catch {
          // navigation superseded
        }
      },
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    expect(await cacheSize(page)).toBe(0); // cleared before the sign-out request even finished
    await page.waitForURL("**/login");
    expect(new URL(page.url()).search).toBe(""); // plain /login: no ?next from a late poll
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // the same account signs in again; with slow answers nothing from before is on screen
    await signIn(page);
    await delayApi(page);
    await page.goto("/");
    await expect(page.getByText("Loading…").first()).toBeVisible();
    await expect(updatedText(page)).toHaveCount(0);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("");
    await expect(updatedText(page)).toBeVisible({ timeout: 15_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("10. a 401 clears the cache and goes to sign-in once, without a loop", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page, [401]);
    await page.setViewportSize({ width: 1440, height: 900 });
    const loginVisits: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const u = new URL(frame.url());
      if (u.pathname === "/login") loginVisits.push(`${u.pathname}${u.search}`);
    });
    await page.goto("/");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    expect(await cacheSize(page)).toBeGreaterThan(0);

    // A stand-in sign-in page, held for a moment: the real session is still valid here, so
    // the real page would send the browser straight back and the test could not tell a loop
    // from a redirect. While it is held the old document is still alive to inspect.
    await page.route(
      (url) => url.pathname === "/login",
      async (route) => {
        await sleep(1500);
        try {
          await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Sign in</title><p>Sign in</p>" });
        } catch {
          // navigation superseded
        }
      },
    );
    await page.route(
      (url) => url.pathname === "/api/metrics/summary",
      (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }),
    );
    await nav(page, "Overview"); // the revisit's poll gets the 401
    await expect
      .poll(async () => page.evaluate(() => {
        const cache = (globalThis as unknown as { __csaSwrCache?: { size(): number } }).__csaSwrCache;
        return cache ? cache.size() : -1;
      }).catch(() => 0), { timeout: 8_000 })
      .toBe(0);
    await page.waitForURL((u) => u.pathname === "/login");
    expect(new URL(page.url()).search).toBe("?next=/");
    expect(page.url().endsWith("/login?next=/")).toBe(true);
    await page.waitForTimeout(3000); // a loop would have visited again by now
    expect(loginVisits).toEqual(["/login?next=/"]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("12. no sideways scroll at 1440 and 390, with and without the notes", async ({ page }) => {
    test.setTimeout(120_000);
    const issues = trackIssues(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await waitOverviewLoaded(page);
      await nav(page, "Incidents");
      await expect(page.locator("[data-incident-id]").first()).toBeAttached({ timeout: 15_000 });
      await nav(page, "Alerts");
      await expect(page.locator("tbody tr td:nth-child(6)").first()).toBeVisible({ timeout: 15_000 });
      await delayApi(page);
      for (const name of ["Overview", "Incidents", "Alerts"] as const) {
        await nav(page, name); // each is a cached revisit with "Refreshing" showing
        await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
        const withNote = await overflow(page);
        // hide the note: whatever scroll remains is not the note's doing
        await page.evaluate(() => {
          const style = document.createElement("style");
          style.id = "hide-refresh-note";
          style.textContent = '[data-testid="refresh-indicator"]{display:none !important}';
          document.head.appendChild(style);
        });
        const without = await overflow(page);
        await page.evaluate(() => document.getElementById("hide-refresh-note")?.remove());
        console.log(`${name} at ${width}px: overflow with the note ${JSON.stringify(withNote)}, without ${JSON.stringify(without)}`);
        expect(withNote.doc, `${name} ${width}px document`).toBeLessThanOrEqual(without.doc);
        expect(withNote.scroller, `${name} ${width}px scroller`).toBeLessThanOrEqual(without.scroller);
        if (name === "Incidents" || width === 1440) {
          expect(withNote.doc, `${name} ${width}px document`).toBeLessThanOrEqual(0);
          expect(withNote.scroller, `${name} ${width}px scroller`).toBeLessThanOrEqual(0);
        }
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
    expect(issues()).toEqual([]);
  });

  test("14. screenshots: the first cached frame, the list with Refreshing", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitOverviewLoaded(page);
    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const sizes: { width: number; height: number }[] = [];
    await delayApi(page);

    await nav(page, "Overview");
    await expect(updatedText(page)).toBeVisible();
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    sizes.push(await shot(page, "swr-overview-first-frame-light-1440.png"));

    await nav(page, "Incidents");
    await expect(incidentRows(page).first()).toBeVisible();
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    sizes.push(await shot(page, "swr-incidents-refreshing-light-1440.png"));

    for (const size of sizes) expectUsable(size);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });
});

function expectUsable(size: { width: number; height: number }) {
  expect(size.width).toBeGreaterThan(40);
  expect(size.height).toBeGreaterThan(40);
}

// ---------------------------------------------------------------------------
// Realistic backend, read only

test.describe("stale-while-revalidate cache (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("13. the Incidents list revisit shows its 8 rows at once and nothing is written", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await expect(incidentRows(page)).toHaveCount(8, { timeout: 15_000 });
    await nav(page, "Overview");
    await waitOverviewLoaded(page);

    await delayApi(page);
    const ms = await timeUntil(
      page,
      () => nav(page, "Incidents"),
      (n: number) => document.querySelectorAll("tbody tr[data-incident-id]").length === n,
      8,
    );
    console.log(`TIMING realistic incidents revisit: 8 rows present ${ms} ms after the click`);
    expect(ms).toBeLessThan(300);
    await expect(page.getByTestId("refresh-indicator")).toHaveText("Refreshing", { timeout: 1500 });
    await expect(page.getByTestId("refresh-indicator")).toHaveText("", { timeout: 15_000 });
    await expect(incidentRows(page)).toHaveCount(8);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
