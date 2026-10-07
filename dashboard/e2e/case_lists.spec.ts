import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  assigneeFilterMatches,
  effectiveCase,
  isUnresolved,
  matchesStatusFilter,
  normalizeStatus,
  parseStatusFilter,
} from "../lib/caseJoin";
import { E2E_DATA_ROOT } from "../playwright.config";

const REALISTIC = Boolean(process.env.E2E_REALISTIC);
const CASES_FILE = path.join(E2E_DATA_ROOT, "cases.json");

// All case spec files share one cases.json in the temp DATA_ROOT, and Playwright
// may run spec files in parallel workers. A mutating describe holds this lock
// folder from its beforeAll to its afterAll so the files take turns.
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
const SHOTS = path.join(__dirname, "screenshots");

// ---------------------------------------------------------------------------
// Pure tests

const summary = (id: string, status: string, assignee: string | null = null) => ({
  incident_id: id,
  status,
  assignee,
  verdict: null,
  updated_time: "2026-10-04T10:00:00.000Z",
});

test.describe("caseJoin: unit", () => {
  const list = [summary("a", "investigating", "Analyst 1"), summary("b", "resolved"), summary("c", "open", "Analyst 2")];

  test("effectiveCase returns the match or the virtual default", () => {
    expect(effectiveCase("a", list)).toBe(list[0]);
    expect(effectiveCase("b", list).status).toBe("resolved");
    expect(effectiveCase("zzz", list)).toEqual({
      incident_id: "zzz",
      status: "open",
      assignee: null,
      verdict: null,
      updated_time: null,
    });
    for (const none of [null, undefined, [] as never[]]) {
      expect(effectiveCase("a", none)).toMatchObject({ status: "open", assignee: null, verdict: null });
    }
    expect(() => effectiveCase("a", [null, undefined, 5] as never)).not.toThrow();
    expect(effectiveCase("a", "nope" as never).status).toBe("open");
  });

  test("isUnresolved for every status and an unknown one", () => {
    expect(isUnresolved("open")).toBe(true);
    expect(isUnresolved("investigating")).toBe(true);
    expect(isUnresolved("resolved")).toBe(false);
    for (const odd of ["on_hold", "", undefined, null, 5, {}]) expect(isUnresolved(odd), String(odd)).toBe(true);
  });

  test("normalizeStatus treats unknown values as open", () => {
    expect(normalizeStatus("resolved")).toBe("resolved");
    expect(normalizeStatus("investigating")).toBe("investigating");
    expect(normalizeStatus("open")).toBe("open");
    expect(normalizeStatus("weird")).toBe("open");
    expect(normalizeStatus(undefined)).toBe("open");
  });

  test("every status filter value", () => {
    const rows: [string, Record<string, boolean>][] = [
      ["open", { all: true, active: true, open: true, investigating: false, resolved: false }],
      ["investigating", { all: true, active: true, open: false, investigating: true, resolved: false }],
      ["resolved", { all: true, active: false, open: false, investigating: false, resolved: true }],
      ["mystery", { all: true, active: true, open: true, investigating: false, resolved: false }],
    ];
    for (const [status, expected] of rows) {
      for (const [filter, want] of Object.entries(expected)) {
        expect(matchesStatusFilter(status, filter), `${status} vs ${filter}`).toBe(want);
      }
    }
  });

  test("an unknown or missing status filter means all", () => {
    for (const filter of ["", "bogus", undefined, null, 3]) {
      expect(matchesStatusFilter("resolved", filter), String(filter)).toBe(true);
      expect(parseStatusFilter(filter)).toBe("all");
    }
    expect(parseStatusFilter("active")).toBe("active");
    expect(parseStatusFilter("open")).toBe("open");
  });

  test("assignee filter: all, unassigned and exact names", () => {
    expect(assigneeFilterMatches(null, "all")).toBe(true);
    expect(assigneeFilterMatches("Analyst 1", "all")).toBe(true);
    expect(assigneeFilterMatches("Analyst 1", "")).toBe(true);
    expect(assigneeFilterMatches(null, "unassigned")).toBe(true);
    expect(assigneeFilterMatches(undefined, "unassigned")).toBe(true);
    expect(assigneeFilterMatches("", "unassigned")).toBe(true);
    expect(assigneeFilterMatches("Analyst 1", "unassigned")).toBe(false);
    expect(assigneeFilterMatches("Analyst 1", "Analyst 1")).toBe(true);
    expect(assigneeFilterMatches("Analyst 2", "Analyst 1")).toBe(false);
    expect(assigneeFilterMatches(null, "Analyst 1")).toBe(false);
    expect(assigneeFilterMatches("analyst 1", "Analyst 1")).toBe(false);
    expect(() => assigneeFilterMatches(null, 5)).not.toThrow();
    expect(assigneeFilterMatches("Analyst 1", 5)).toBe(true);
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

async function shot(locator: Locator, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await locator.screenshot({ path: file });
  const size = pngSize(file);
  console.log(`${name} ${size.width}x${size.height}`);
  return size;
}

function expectUsable(size: { width: number; height: number }) {
  expect(size.width).toBeGreaterThan(250);
  expect(size.height).toBeGreaterThan(40);
}

// Same guard as case_ui.spec.ts: the backend must be using the temp DATA_ROOT.
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
const patchCase = (page: Page, id: string, data: Record<string, unknown>) =>
  page.request.patch(caseUrl(id), { data, headers: { "x-actor": "Tester" } });
const resolveCase = (page: Page, id: string, verdict: string) =>
  page.request.post(`${caseUrl(id)}/resolve`, { data: { verdict }, headers: { "x-actor": "Tester" } });

const row = (page: Page, id: string) => page.locator(`tbody tr[data-incident-id="${id}"]`);
const statusOf = (page: Page, id: string) => row(page, id).getByTestId("cell-status").locator("[data-status]");
const assigneeOf = (page: Page, id: string) => row(page, id).getByTestId("cell-assignee");
// The filter caption and its select live in one <label>, so find the select by its caption.
const filterSelect = (page: Page, caption: "Status" | "Assignee") =>
  page.locator("label").filter({ has: page.locator("span", { hasText: new RegExp(`^${caption}$`) }) }).locator("select");
const showing = (page: Page) => page.getByText(/Showing \d+ of \d+ incidents/);

async function rowIds(page: Page): Promise<string[]> {
  return page.locator("tbody tr[data-incident-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-incident-id") ?? ""));
}

// Real changes only on inc-0001 and inc-0005: no other spec renders their case
// state, so parallel workers never see it. inc-0001 is investigating and
// assigned, inc-0005 is resolved.
async function realStatuses(page: Page) {
  expect((await patchCase(page, "inc-0001", { assignee: "Analyst 1", status: "investigating" })).status()).toBe(200);
  expect((await resolveCase(page, "inc-0005", "true_positive")).status()).toBe(200);
}

// Filter permutations use a mocked case list instead of writing to the backend:
// inc-0001 investigating and assigned, inc-0002 resolved, inc-0003 open and assigned.
const MOCK_CASES = [
  { incident_id: "inc-0001", status: "investigating", assignee: "Analyst 1", verdict: null, resolved_time: null, updated_time: "2026-10-04T10:00:00.000Z", version: 3 },
  { incident_id: "inc-0002", status: "resolved", assignee: null, verdict: "true_positive", resolved_time: "2026-10-04T10:00:00.000Z", updated_time: "2026-10-04T10:00:00.000Z", version: 2 },
  { incident_id: "inc-0003", status: "open", assignee: "Analyst 2", verdict: null, resolved_time: null, updated_time: "2026-10-04T10:00:00.000Z", version: 2 },
];
async function mockedStatuses(page: Page) {
  await page.route("**/api/cases", (route) => route.fulfill({ json: MOCK_CASES }));
}

async function openList(page: Page, query = "") {
  await page.goto(`/incidents${query}`);
  await page.waitForSelector("tbody tr[data-incident-id]", { timeout: 15_000 });
  // case data rides on the same poll; wait for it to settle
  await page.waitForLoadState("networkidle");
}

test.describe("case data on the Incidents list and Overview (default backend, temp DATA_ROOT)", () => {
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

  test("5a. rows show the real status and assignee; unaffected incidents are Open and Unassigned", async ({ page }) => {
    const issues = trackIssues(page);
    await realStatuses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);

    await expect(statusOf(page, "inc-0001")).toHaveAttribute("data-status", "investigating");
    await expect(assigneeOf(page, "inc-0001")).toHaveText("Analyst 1");
    await expect(statusOf(page, "inc-0005")).toHaveAttribute("data-status", "resolved");
    await expect(assigneeOf(page, "inc-0005")).toHaveText("Unassigned");
    for (const id of ["inc-0002", "inc-0003", "inc-0004"]) {
      await expect(statusOf(page, id)).toHaveAttribute("data-status", "open");
      await expect(assigneeOf(page, id)).toHaveText("Unassigned");
    }
    await expect(showing(page)).toHaveText("Showing 5 of 5 incidents");
    await expect(page.getByTestId("cases-unavailable")).toHaveCount(0);
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);

    // the list has six columns: Status and Assignee follow Triage
    const headers = await page.locator("thead th").allInnerTexts();
    expect(headers.map((h) => h.replace(/[▲▼⇅]/g, "").trim()).slice(0, 6)).toEqual([
      "Severity", "Incident", "Raised", "Triage", "Status", "Assignee",
    ]);
    expect(issues()).toEqual([]);
  });

  test("5b. status and assignee filters, the count line and the URL", async ({ page }) => {
    const issues = trackIssues(page);
    await mockedStatuses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    const statusSelect = filterSelect(page, "Status");
    const assigneeSelect = filterSelect(page, "Assignee");
    await expect(statusSelect).toHaveValue("all");
    await expect(assigneeSelect).toHaveValue("all");
    expect(await statusSelect.locator("option").allInnerTexts()).toEqual(["All", "Active", "Open", "Investigating", "Resolved"]);
    expect((await assigneeSelect.locator("option").allInnerTexts()).slice(0, 2)).toEqual(["All", "Unassigned"]);

    const ids = async () => (await rowIds(page)).sort();

    await statusSelect.selectOption("active");
    expect(await ids()).toEqual(["inc-0001", "inc-0003", "inc-0004", "inc-0005"]);
    await expect(showing(page)).toHaveText("Showing 4 of 5 incidents");

    await statusSelect.selectOption("resolved");
    expect(await ids()).toEqual(["inc-0002"]);
    await expect(showing(page)).toHaveText("Showing 1 of 5 incidents");

    await statusSelect.selectOption("open");
    expect(await ids()).toEqual(["inc-0003", "inc-0004", "inc-0005"]);
    await statusSelect.selectOption("investigating");
    expect(await ids()).toEqual(["inc-0001"]);

    await statusSelect.selectOption("all");
    await assigneeSelect.selectOption("unassigned");
    expect(await ids()).toEqual(["inc-0002", "inc-0004", "inc-0005"]);
    await assigneeSelect.selectOption("Analyst 2");
    expect(await ids()).toEqual(["inc-0003"]);
    await assigneeSelect.selectOption("Analyst 1");
    expect(await ids()).toEqual(["inc-0001"]);

    // together, and in the URL
    await assigneeSelect.selectOption("unassigned");
    await statusSelect.selectOption("active");
    expect(await ids()).toEqual(["inc-0004", "inc-0005"]);
    await expect(showing(page)).toHaveText("Showing 2 of 5 incidents");
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("active");
    expect(new URL(page.url()).searchParams.get("assignee")).toBe("unassigned");

    await page.reload();
    await page.waitForSelector("tbody tr[data-incident-id]");
    await expect(statusSelect).toHaveValue("active");
    await expect(assigneeSelect).toHaveValue("unassigned");
    expect(await ids()).toEqual(["inc-0004", "inc-0005"]);

    // a name survives the URL too
    await assigneeSelect.selectOption("Analyst 2");
    await statusSelect.selectOption("all");
    await expect.poll(() => new URL(page.url()).searchParams.get("assignee")).toBe("Analyst 2");
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBeNull();
    await page.reload();
    await page.waitForSelector("tbody tr[data-incident-id]");
    await expect(assigneeSelect).toHaveValue("Analyst 2");
    expect(await ids()).toEqual(["inc-0003"]);
    expect(issues()).toEqual([]);
  });

  test("5c. a legacy status=open link means Open exactly; the old chip is gone", async ({ page }) => {
    const issues = trackIssues(page);
    await mockedStatuses(page);
    await openList(page, "?status=open");
    await expect(filterSelect(page, "Status")).toHaveValue("open");
    expect((await rowIds(page)).sort()).toEqual(["inc-0003", "inc-0004", "inc-0005"]);
    await expect(page.getByText("Status: open")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear status filter" })).toHaveCount(0);

    await openList(page, "?status=active");
    expect((await rowIds(page)).sort()).toEqual(["inc-0001", "inc-0003", "inc-0004", "inc-0005"]);
    await openList(page, "?status=nonsense");
    await expect(filterSelect(page, "Status")).toHaveValue("all");
    expect(issues()).toEqual([]);
  });

  test("5d. Raised shows a formatted time, the UTC time in its title, and sorts by the real timestamp", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);

    const raisedCells = page.locator('tbody tr[data-incident-id] [data-testid="cell-raised"]');
    const texts = await raisedCells.allInnerTexts();
    const titles = await raisedCells.evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    expect(texts.length).toBe(5);
    for (const t of texts) {
      expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(t).toMatch(/^\d{2} [A-Z][a-z]{2}, \d{2}:\d{2}$/);
    }
    for (const t of titles) expect(t).toMatch(/\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\)$/);
    await expect(page.locator("thead th", { hasText: "Raised" })).toHaveAttribute("title", /^Times are shown in UTC[+-]/);
    await expect(raisedCells.first()).toHaveCSS("text-align", "right");

    // newest first by default, oldest first after one click
    const epoch = (t: string) => Date.parse(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\)$/.exec(t)![1].replace(" ", "T") + "Z");
    const desc = titles.map(epoch);
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);
    await page.locator("thead th", { hasText: "Raised" }).click();
    const asc = (await raisedCells.evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""))).map(epoch);
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);
    expect(issues()).toEqual([]);
  });

  test("5e. sorting uses the real timestamp even when the text would order differently", async ({ page }) => {
    const issues = trackIssues(page);
    const real = (await (await page.request.get("/api/incidents?limit=5")).json()) as Record<string, unknown>[];
    const early = { ...real[0], incident_id: "mock-early", incident_raised_time: "2026-10-04T10:30:00.000+07:00" }; // 03:30Z
    const late = { ...real[1], incident_id: "mock-late", incident_raised_time: "2026-10-04T09:00:00.000Z" }; // 09:00Z
    await page.route(/\/api\/incidents(\?.*)?$/, (route) => route.fulfill({ json: [early, late] }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await page.waitForSelector("tbody tr[data-incident-id]");
    // The text "...T09:00" sorts before "...T10:30", but 09:00Z is the later time.
    expect(await rowIds(page)).toEqual(["mock-late", "mock-early"]);
    await page.locator("thead th", { hasText: "Raised" }).click();
    expect(await rowIds(page)).toEqual(["mock-early", "mock-late"]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("5f. there is no Last action column; the six columns stay visible at every width", async ({ page }) => {
    const issues = trackIssues(page);
    await openList(page);
    for (const width of [1920, 1366, 1280, 1100, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("thead th", { hasText: "Last action" }), `${width}px`).toHaveCount(0);
      for (const name of ["Severity", "Incident", "Raised", "Triage", "Status", "Assignee"]) {
        await expect(page.locator("thead th", { hasText: name }).first(), `${name} at ${width}px`).toBeVisible();
      }
      // the data cells follow their header: six columns plus the chevron
      const cells = await page.locator("tbody tr[data-incident-id]").first().locator("td").evaluateAll((els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null).length,
      );
      expect(cells, `${width}px visible cells`).toBe(7);
    }
    expect(issues()).toEqual([]);
  });

  test("5g. case data unavailable: the list stays, every incident is Open, a muted note appears", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    await page.route("**/api/cases", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await patchCase(page, "inc-0001", { status: "investigating" }); // not visible while the route is mocked
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    expect((await rowIds(page)).length).toBe(5);
    for (const id of await rowIds(page)) await expect(statusOf(page, id)).toHaveAttribute("data-status", "open");
    await expect(page.getByTestId("cases-unavailable")).toHaveText("Case data unavailable");
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);
    await expect(showing(page)).toHaveText("Showing 5 of 5 incidents");

    // when the service answers again the real data returns and the note goes
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await expect(statusOf(page, "inc-0001")).toHaveAttribute("data-status", "investigating", { timeout: 15_000 });
    await expect(page.getByTestId("cases-unavailable")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("5h. no horizontal scroll on the list at 1440 and 390", async ({ page }) => {
    const issues = trackIssues(page);
    await realStatuses(page);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/incidents");
      await page.waitForSelector(width >= 768 ? "tbody tr[data-incident-id]" : ".md\\:hidden > div");
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector("body > div > div:last-child") as HTMLElement;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scroller: scroller.scrollWidth - scroller.clientWidth,
        };
      });
      expect(overflow.doc, `${width}px document`).toBeLessThanOrEqual(0);
      expect(overflow.scroller, `${width}px scroller`).toBeLessThanOrEqual(0);
    }
    expect(issues()).toEqual([]);
  });

  test("6. Overview: Open incidents counts unresolved cases and links to status=active", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const all = (await (await page.request.get("/api/incidents?limit=500")).json()) as { incident_id: string; severity: string }[];
    const openCard = page.locator('a[href="/incidents?status=active"]');
    const openNow = async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "All", exact: true }).click();
      await expect(openCard).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");
    };

    await openNow();
    await expect(openCard).toHaveText(String(all.length));
    const before = Number(await openCard.innerText());
    expect(before).toBe(5);

    // resolve one incident through the API
    const victim = all.find((i) => i.incident_id === "inc-0005")!;
    expect((await resolveCase(page, victim.incident_id, "false_positive")).status()).toBe(200);
    await openNow();
    await expect(openCard).toHaveText(String(before - 1));

    // the severity breakdown matches the unresolved incidents
    const expected: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const i of all) if (i.incident_id !== victim.incident_id) expected[i.severity] += 1;
    for (const [sev, count] of Object.entries(expected)) {
      const chip = page.locator(`a[href="/incidents?status=active&severity=${sev}"]`);
      await expect(chip, sev).toBeVisible();
      await expect(chip.locator("span.font-semibold"), sev).toHaveText(String(count));
    }

    // the Newest incidents list shows only unresolved incidents
    const newest = page.getByText("Newest incidents", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(newest.locator("a[href^='/incidents/inc-']")).toHaveCount(before - 1);
    await expect(newest.locator(`a[href='/incidents/${victim.incident_id}']`)).toHaveCount(0);

    // following the link lands on the Active filter with the same count
    await openCard.click();
    await page.waitForURL(/\/incidents\?status=active/);
    await page.waitForSelector("tbody tr[data-incident-id]");
    await expect(filterSelect(page, "Status")).toHaveValue("active");
    expect((await rowIds(page)).length).toBe(before - 1);
    expect(issues()).toEqual([]);
  });

  test("6b. Overview: case data unavailable counts every incident as open, with no error banner", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    expect((await resolveCase(page, "inc-0005", "false_positive")).status()).toBe(200);
    await page.route("**/api/cases", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const openCard = page.locator('a[href="/incidents?status=active"]');
    await expect(openCard).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const total = ((await (await page.request.get("/api/incidents?limit=500")).json()) as unknown[]).length;
    await expect(openCard).toHaveText(String(total));
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("10. screenshots: list with mixed statuses (light and dark) and the Overview with one resolved incident", async ({ page }) => {
    const issues = trackIssues(page);
    await mockedStatuses(page);
    for (const theme of ["light", "dark"] as const) {
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openList(page);
      expectUsable(await shot(page.locator("main"), `incidents-list-cases-${theme}-1440.png`));
    }

    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect((await resolveCase(page, "inc-0005", "true_positive")).status()).toBe(200);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.locator('a[href="/incidents?status=active"]')).toHaveText("4", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const needs = page.locator("section").filter({ has: page.getByText("Needs attention", { exact: true }) }).first();
    expectUsable(await shot(needs, "overview-needs-attention-resolved-light-1440.png"));
    expect(issues()).toEqual([]);
  });
});

test.describe("case data on the lists (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("8. the list and Overview agree with the real case data and nothing is written", async ({ page }) => {
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });
    const caseList = (await (await page.request.get("/api/cases")).json()) as { incident_id: string; status: string; assignee: string | null }[];
    const incidents = (await (await page.request.get("/api/incidents?limit=500")).json()) as { incident_id: string }[];
    expect(incidents.length).toBe(8);
    const byId = new Map(caseList.map((c) => [c.incident_id, c]));
    const expectedStatus = (id: string) => normalizeStatus(byId.get(id)?.status);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    expect((await rowIds(page)).sort()).toEqual(incidents.map((i) => i.incident_id).sort());
    for (const { incident_id: id } of incidents) {
      await expect(statusOf(page, id), id).toHaveAttribute("data-status", expectedStatus(id));
      const assignee = byId.get(id)?.assignee;
      await expect(assigneeOf(page, id), id).toHaveText(assignee || "Unassigned");
    }
    await expect(showing(page)).toHaveText("Showing 8 of 8 incidents");

    // incidents without a stored case read Open and Unassigned
    const noCase = incidents.filter((i) => !byId.has(i.incident_id));
    expect(noCase.length).toBeGreaterThan(0);
    for (const { incident_id: id } of noCase) {
      await expect(statusOf(page, id)).toHaveAttribute("data-status", "open");
      await expect(assigneeOf(page, id)).toHaveText("Unassigned");
    }

    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const openCard = page.locator('a[href="/incidents?status=active"]');
    await expect(openCard).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    const unresolved = incidents.filter((i) => isUnresolved(expectedStatus(i.incident_id))).length;
    await expect(openCard).toHaveText(String(unresolved));

    await page.waitForTimeout(1500);
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
