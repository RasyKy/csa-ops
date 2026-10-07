import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
// inc-0005 is used by no other spec, so parallel workers never see these changes.
const INC = "inc-0005";
const CASE_URL = `/api/incidents/${INC}/case`;
const EMPTY_STATE = { cookies: [], origins: [] };

// Chromium logs its own "Failed to load resource" console error for every 4xx or
// 5xx answer. A test whose stimulus is such an answer names the status here; no
// other test tolerates any console message.
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

const card = (page: Page) => page.getByTestId("case-card");
const headerStatus = (page: Page) => page.getByTestId("header-status").locator("[data-status]");
const headerAssignee = (page: Page) => page.getByTestId("header-assignee");

async function open(page: Page, id = INC, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(`/incidents/${id}`);
  await expect(page.getByTestId("case-card")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
}

async function apiCase(page: Page, id = INC) {
  const res = await page.request.get(`/api/incidents/${id}/case`);
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    status: string;
    assignee: string | null;
    verdict: string | null;
    resolution_note: string | null;
    version: number;
    events: { id: string; type: string; actor: string; data: Record<string, unknown> }[];
  };
}

async function shot(locator: Locator, name: string): Promise<{ width: number; height: number }> {
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

async function startInvestigating(page: Page) {
  await card(page).getByRole("button", { name: "Start investigating" }).click();
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "investigating");
}

async function resolveAs(page: Page, verdictName: string, note = "") {
  await card(page).getByRole("button", { name: "Resolve", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve case" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: verdictName }).check();
  if (note) await dialog.getByLabel("Resolution note (optional)").fill(note);
  await dialog.getByRole("button", { name: "Resolve case" }).click();
  await expect(dialog).toBeHidden();
}

// The backend must be the one Playwright started with DATA_ROOT redirected.
// Prove it without mutating anything real: plant a sentinel case in the temp
// directory and require the API to list it, then remove it again.
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

test.describe("case UI (mutating, default backend with a temp DATA_ROOT)", () => {
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

  test("1. virtual default: Open, Unassigned, nothing written", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "open");
    await expect(card(page).getByLabel("Assignee")).toHaveValue("Unassigned");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "open");
    await expect(headerAssignee(page)).toHaveText("Unassigned");
    await expect(card(page).getByRole("button", { name: "Start investigating" })).toBeVisible();
    await expect(card(page).getByText("Recorded as")).toBeVisible();
    await expect(
      card(page).getByText("Case changes are for analysts. They never change detections or response actions."),
    ).toBeVisible();
    expect(fs.existsSync(CASES_FILE)).toBe(false);
    const body = await apiCase(page);
    expect(body.version).toBe(0);
    expect(body.events).toEqual([]);
    expect(issues()).toEqual([]);
  });

  test("2. assign: header, reload and the API agree", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await card(page).getByLabel("Assignee").selectOption("Analyst 1");
    await expect(headerAssignee(page)).toHaveText("Analyst 1");
    await expect(card(page).getByLabel("Assignee")).toHaveValue("Analyst 1");

    await page.reload();
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
    await expect(headerAssignee(page)).toHaveText("Analyst 1");
    await expect(card(page).getByLabel("Assignee")).toHaveValue("Analyst 1");

    const body = await apiCase(page);
    expect(body.version).toBe(2);
    expect(body.events.map((e) => e.type)).toEqual(["created", "assignee_changed"]);
    expect(body.events.map((e) => e.actor)).toEqual(["Analyst", "Analyst"]);
    expect(body.events[1].data).toEqual({ from: null, to: "Analyst 1" });
    expect(fs.existsSync(CASES_FILE)).toBe(true);

    await card(page).getByLabel("Assignee").selectOption("Unassigned");
    await expect(headerAssignee(page)).toHaveText("Unassigned");
    expect((await apiCase(page)).assignee).toBeNull();
    expect(issues()).toEqual([]);
  });

  test("3. the recorded-as name is used, kept and cleaned", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Analyst");

    await card(page).getByRole("button", { name: "Change" }).click();
    const input = card(page).getByLabel("Your name");
    await expect(input).toBeFocused();
    await input.fill("Pri\u0007ya\u0001");
    await input.press("Enter");
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Priya");

    // Escape cancels an edit
    await card(page).getByRole("button", { name: "Change" }).click();
    await card(page).getByLabel("Your name").fill("Zed");
    await card(page).getByLabel("Your name").press("Escape");
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Priya");
    await expect(card(page).getByRole("button", { name: "Change" })).toBeFocused();

    // Save and Cancel buttons
    await card(page).getByRole("button", { name: "Change" }).click();
    await card(page).getByLabel("Your name").fill("   ");
    await card(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Analyst");
    await card(page).getByRole("button", { name: "Change" }).click();
    await card(page).getByLabel("Your name").fill("Priya");
    await card(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Priya");

    await card(page).getByLabel("Assignee").selectOption("Analyst 2");
    await expect(headerAssignee(page)).toHaveText("Analyst 2");
    const body = await apiCase(page);
    expect(body.events.map((e) => e.actor)).toEqual(["Priya", "Priya"]);

    await page.reload();
    await expect(page.getByTestId("recorded-as-name")).toHaveText("Priya");
    expect(await page.evaluate(() => localStorage.getItem("csa-actor-name"))).toBe("Priya");
    expect(issues()).toEqual([]);
  });

  test("4. start investigating, mark as open, start again: badges and versions follow", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);

    await startInvestigating(page);
    await expect(headerStatus(page)).toHaveAttribute("data-status", "investigating");
    await expect(card(page).getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Mark as open" })).toBeVisible();
    expect((await apiCase(page)).version).toBe(2);

    await card(page).getByRole("button", { name: "Mark as open" }).click();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "open");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "open");
    expect((await apiCase(page)).version).toBe(3);

    await startInvestigating(page);
    const body = await apiCase(page);
    expect(body.version).toBe(4);
    expect(body.events.map((e) => e.type)).toEqual(["created", "status_changed", "status_changed", "status_changed"]);
    expect(body.events[1].data).toEqual({ from: "open", to: "investigating" });
    expect(body.events[2].data).toEqual({ from: "investigating", to: "open" });
    expect(issues()).toEqual([]);
  });

  test("5. resolve flow", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await startInvestigating(page);

    const opener = card(page).getByRole("button", { name: "Resolve", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Verdict" })).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    for (const radio of await dialog.getByRole("radio").all()) await expect(radio).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Resolve case" })).toBeDisabled();
    await expect(dialog.getByText("The detection fired but nothing harmful happened.")).toBeVisible();
    await expect(dialog.getByText("0 / 1000")).toBeVisible();

    // Escape closes without changing anything and returns focus to the opener
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect((await apiCase(page)).status).toBe("investigating");

    // Cancel changes nothing either
    await opener.click();
    await dialog.getByRole("radio", { name: "True positive" }).check();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect((await apiCase(page)).version).toBe(2);

    // The dialog starts clean each time, then resolve for real
    await opener.click();
    for (const radio of await dialog.getByRole("radio").all()) await expect(radio).not.toBeChecked();
    await dialog.getByRole("radio", { name: "False positive" }).check();
    await expect(dialog.getByRole("button", { name: "Resolve case" })).toBeEnabled();
    await dialog.getByLabel("Resolution note (optional)").fill("Admin script");
    await expect(dialog.getByText("12 / 1000")).toBeVisible();
    await dialog.getByRole("button", { name: "Resolve case" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "resolved");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "resolved");
    await expect(page.getByTestId("case-verdict")).toHaveText("False positive");
    await expect(page.getByTestId("case-resolution-note")).toHaveText("Admin script");
    await expect(card(page).getByText(/^Resolved\s/)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Reopen" })).toBeVisible();

    const body = await apiCase(page);
    expect(body.status).toBe("resolved");
    expect(body.verdict).toBe("false_positive");
    expect(body.resolution_note).toBe("Admin script");
    expect(issues()).toEqual([]);
  });

  test("5b. the backdrop closes the dialog and the note stops at 1000 characters", async ({ page }) => {
    await open(page);
    await startInvestigating(page);
    const opener = card(page).getByRole("button", { name: "Resolve", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await dialog.getByLabel("Resolution note (optional)").fill("x".repeat(1200));
    await expect(dialog.getByText("1000 / 1000")).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect((await apiCase(page)).version).toBe(2);
  });

  test("6. reopen keeps the whole audit trail", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await startInvestigating(page);
    await resolveAs(page, "True positive", "Confirmed");
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "resolved");

    await card(page).getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "investigating");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "investigating");
    await expect(page.getByTestId("case-verdict")).toHaveCount(0);
    await expect(page.getByTestId("case-resolution-note")).toHaveCount(0);
    await expect(card(page).getByText("Confirmed")).toHaveCount(0);

    const body = await apiCase(page);
    expect(body.status).toBe("investigating");
    expect(body.verdict).toBeNull();
    expect(body.resolution_note).toBeNull();
    expect(body.events.map((e) => e.type)).toEqual(["created", "status_changed", "resolved", "reopened"]);
    expect(body.events[2].data).toEqual({ verdict: "true_positive", note: "Confirmed" });
    expect(issues()).toEqual([]);
  });

  test("7. conflict: someone else changed the case first", async ({ page }) => {
    const issues = trackIssues(page, [409]);
    await open(page);

    const other = await page.request.patch(CASE_URL, {
      data: { assignee: "Analyst 2" },
      headers: { "content-type": "application/json", "x-actor": "Someone%20else" },
    });
    expect(other.status()).toBe(200);

    await card(page).getByRole("button", { name: "Start investigating" }).click();
    const notice = page.getByTestId("case-conflict");
    await expect(notice).toContainText("This case was changed by someone else. Showing the latest version.");
    await expect(headerAssignee(page)).toHaveText("Analyst 2");
    await expect(card(page).getByLabel("Assignee")).toHaveValue("Analyst 2");
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "open");
    expect((await apiCase(page)).version).toBe(2);

    // the next successful action clears the notice
    await card(page).getByRole("button", { name: "Start investigating" }).click();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "investigating");
    await expect(notice).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("7b. buttons are disabled while a change is in flight", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await page.route("**/api/incidents/*/case", async (route) => {
      if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    const start = card(page).getByRole("button", { name: "Start investigating" });
    await start.click();
    await expect(start).toBeDisabled();
    await expect(card(page).getByLabel("Assignee")).toBeDisabled();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "investigating");
    await expect(card(page).getByLabel("Assignee")).toBeEnabled();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("8b. backend unavailable: the card shows a notice, the page keeps working", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.route("**/api/incidents/*/case", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.goto(`/incidents/${INC}`);
    const error = page.getByTestId("case-error");
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText("Case data is unavailable right now. The rest of this page still works.");
    await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByText("Event timeline", { exact: false })).toBeVisible();
    await expect(page.getByText("Response history", { exact: true })).toBeVisible();
    await expect(page.getByTestId("header-status")).toContainText("Unavailable");

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await expect(page.getByTestId("case-error")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("10. no horizontal scroll at 1440 and 390", async ({ page }) => {
    const issues = trackIssues(page);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector("body > div > div:last-child") as HTMLElement;
        const c = document.querySelector('[data-testid="case-card"]') as HTMLElement;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scroller: scroller.scrollWidth - scroller.clientWidth,
          card: c.scrollWidth - c.clientWidth,
        };
      });
      expect(overflow.doc, `${width}px document`).toBeLessThanOrEqual(0);
      expect(overflow.card, `${width}px card`).toBeLessThanOrEqual(0);
    }
    expect(issues()).toEqual([]);
  });

  test("11. screenshots", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);

    expectUsable(await shot(card(page), "case-card-open-light-1440.png"));
    await startInvestigating(page);
    expectUsable(await shot(card(page), "case-card-investigating-light-1440.png"));

    // resolve dialog (light)
    await card(page).getByRole("button", { name: "Resolve", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "False positive" }).check();
    await dialog.getByLabel("Resolution note (optional)").fill("Scheduled admin script.");
    expectUsable(await shot(dialog, "case-resolve-dialog-light-1440.png"));
    await dialog.getByRole("button", { name: "Resolve case" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "resolved");
    expectUsable(await shot(card(page), "case-card-resolved-light-1440.png"));
    expect(issues()).toEqual([]);
  });

  test("11b. screenshots in dark and at 390 wide", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, INC, "dark");
    expectUsable(await shot(card(page), "case-card-open-dark-1440.png"));

    await startInvestigating(page);
    await card(page).getByRole("button", { name: "Resolve", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Benign activity" }).check();
    expectUsable(await shot(dialog, "case-resolve-dialog-dark-1440.png"));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 390 wide: the card and the header
    await page.setViewportSize({ width: 390, height: 2400 });
    await page.reload();
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
    expectUsable(await shot(card(page), "case-card-investigating-dark-390.png"));
    // the header: the property bar with severity, status, assignee, host, user and raised time
    expectUsable(await shot(page.locator("main > div.pb-4").first(), "case-header-dark-390.png"));
    expect(issues()).toEqual([]);
  });
});

test.describe("case proxy hardening", () => {
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

  test("no session gets 401 on every case route", async ({ browser }) => {
    const context = await browser.newContext({ storageState: EMPTY_STATE, baseURL: "http://localhost:3000" });
    const request = context.request;
    for (const [method, url] of [
      ["get", CASE_URL],
      ["patch", CASE_URL],
      ["post", `${CASE_URL}/notes`],
      ["post", `${CASE_URL}/resolve`],
      ["post", `${CASE_URL}/reopen`],
      ["get", "/api/cases"],
      ["get", "/api/cases/assignees"],
    ] as const) {
      const res = await request[method](url, method === "get" ? {} : { data: {} });
      expect(res.status(), `${method} ${url}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    await context.close();
  });

  test("a mismatched Origin is refused on every mutation", async ({ request }) => {
    for (const [method, url] of [
      ["patch", CASE_URL],
      ["post", `${CASE_URL}/notes`],
      ["post", `${CASE_URL}/resolve`],
      ["post", `${CASE_URL}/reopen`],
    ] as const) {
      const res = await request[method](url, {
        data: { text: "x" },
        headers: { origin: "https://evil.example", "content-type": "application/json" },
      });
      expect(res.status(), `${method} ${url}`).toBe(403);
    }
    expect(fs.existsSync(CASES_FILE)).toBe(false);
  });

  test("invalid ids are 400", async ({ request }) => {
    for (const id of ["bad%20id", "a.b", "x".repeat(65), "a%3Bb"]) {
      const get = await request.get(`/api/incidents/${id}/case`);
      expect(get.status(), id).toBe(400);
      expect(await get.json()).toEqual({ error: "invalid_id" });
      const patch = await request.patch(`/api/incidents/${id}/case`, { data: { status: "investigating" } });
      expect(patch.status(), id).toBe(400);
    }
    expect(fs.existsSync(CASES_FILE)).toBe(false);
  });

  test("bad bodies: invalid JSON 400, wrong content type 415, 9 KB body 413", async ({ request }) => {
    // a Buffer is sent as is; a string would be JSON-encoded by the client
    const bad = await request.patch(CASE_URL, {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{not json"),
    });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_json" });
    for (const raw of ['"just a string"', "[1,2]", "null", "42"]) {
      const res = await request.patch(CASE_URL, { headers: { "content-type": "application/json" }, data: Buffer.from(raw) });
      expect(res.status(), raw).toBe(400);
    }

    const plain = await request.patch(CASE_URL, { headers: { "content-type": "text/plain" }, data: "{}" });
    expect(plain.status()).toBe(415);
    const form = await request.post(`${CASE_URL}/notes`, { form: { text: "x" } });
    expect(form.status()).toBe(415);

    const big = await request.post(`${CASE_URL}/notes`, { data: { text: "x".repeat(9 * 1024) } });
    expect(big.status()).toBe(413);
    const bigPatch = await request.patch(CASE_URL, { data: { assignee: "y".repeat(9 * 1024) } });
    expect(bigPatch.status()).toBe(413);
    expect(fs.existsSync(CASES_FILE)).toBe(false);
  });

  test("x-actor is cleaned before it reaches the case", async ({ request }) => {
    const long = await request.post(`${CASE_URL}/notes`, {
      data: { text: "one" },
      headers: { "x-actor": `\t  ${"N".repeat(100)}  ` },
    });
    expect(long.status()).toBe(200);
    expect((await long.json()).events[1].actor).toBe("N".repeat(64));

    // control characters arrive URI-encoded (a raw one cannot be sent in a header)
    const encoded = await request.post(`${CASE_URL}/notes`, {
      data: { text: "two" },
      headers: { "x-actor": encodeURIComponent("Bad\u0001Na\u0007me   X") },
    });
    expect((await encoded.json()).events[2].actor).toBe("BadName X");

    const none = await request.post(`${CASE_URL}/notes`, { data: { text: "three" } });
    expect((await none.json()).events[3].actor).toBe("Analyst");

    const markup = await request.post(`${CASE_URL}/notes`, {
      data: { text: "four" },
      headers: { "x-actor": "<b>M</b>" },
    });
    expect((await markup.json()).events[4].actor).toBe("<b>M</b>");

    const khmer = await request.post(`${CASE_URL}/notes`, {
      data: { text: "five" },
      headers: { "x-actor": encodeURIComponent("Dara អ") },
    });
    expect(khmer.status()).toBe(200);
    expect((await khmer.json()).events[5].actor).toBe("Dara ?");
  });

  test("backend answers pass through unchanged: 409, 404 and 422", async ({ request }) => {
    const resolvedViaPatch = await request.patch(CASE_URL, { data: { status: "resolved" } });
    expect(resolvedViaPatch.status()).toBe(409);
    const body = await resolvedViaPatch.json();
    expect(body.detail).toContain("resolve");
    expect(body.case).toMatchObject({ incident_id: INC, status: "open", version: 0 });

    const stale = await request.post(`${CASE_URL}/notes`, { data: { text: "x", expected_version: 7 } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).case.version).toBe(0);

    const unknown = await request.get("/api/incidents/inc-9999/case");
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual({ detail: "incident not found" });
    const unknownPatch = await request.patch("/api/incidents/inc-9999/case", { data: { assignee: "Analyst 1" } });
    expect(unknownPatch.status()).toBe(404);

    const badAssignee = await request.patch(CASE_URL, { data: { assignee: "Mallory" } });
    expect(badAssignee.status()).toBe(422);
    expect((await badAssignee.json()).detail).toContain("assignee must be one of");
    const emptyNote = await request.post(`${CASE_URL}/notes`, { data: { text: "   " } });
    expect(emptyNote.status()).toBe(422);
    expect(fs.existsSync(CASES_FILE)).toBe(false);
  });

  test("list and assignees routes", async ({ request }) => {
    const assignees = await request.get("/api/cases/assignees");
    expect(await assignees.json()).toEqual(["Unassigned", "Analyst 1", "Analyst 2", "Analyst 3"]);
    expect(await (await request.get("/api/cases")).json()).toEqual([]);
    await request.patch(CASE_URL, { data: { assignee: "Analyst 1" } });
    const list = (await (await request.get("/api/cases?assignee=Analyst%201&status=open")).json()) as { incident_id: string }[];
    expect(list.map((c) => c.incident_id)).toEqual([INC]);
    expect(await (await request.get("/api/cases?status=resolved")).json()).toEqual([]);
    expect((await request.get(`/api/cases?status=${"x".repeat(100)}`)).status()).toBe(400);
    // only the two filters are forwarded
    expect((await request.get("/api/cases?limit=1&evil=1")).status()).toBe(200);
  });

  test("no response carries the API key, the upstream URL or a cookie header", async ({ request }) => {
    const envFile = path.join(__dirname, "..", ".env.local");
    const key = fs.existsSync(envFile) ? /^DASHBOARD_API_KEY=(.*)$/m.exec(fs.readFileSync(envFile, "utf-8"))?.[1]?.trim() : "";
    const responses = [
      await request.get(CASE_URL),
      await request.patch(CASE_URL, { data: { status: "resolved" } }),
      await request.get("/api/incidents/inc-9999/case"),
      await request.get("/api/cases"),
      await request.get("/api/cases/assignees"),
      await request.post(`${CASE_URL}/notes`, { data: { text: "k" } }),
    ];
    for (const res of responses) {
      const text = await res.text();
      const headers = JSON.stringify(res.headersArray());
      if (key && key.length >= 8) {
        expect(text).not.toContain(key);
        expect(headers).not.toContain(key);
      }
      expect(text).not.toContain("localhost:8000");
      expect(headers.toLowerCase()).not.toContain("x-api-key");
      expect(headers.toLowerCase()).not.toContain("localhost:8000");
    }
  });

  test("the UI never offers a response action", async ({ page }) => {
    const sent: string[] = [];
    // Only the dashboard's own API calls count; Next's dev tooling makes other non-GET requests.
    page.on("request", (r) => {
      const { pathname } = new URL(r.url());
      if (r.method() !== "GET" && pathname.startsWith("/api/")) sent.push(`${r.method()} ${pathname}`);
    });
    await open(page);
    const text = (await card(page).innerText()).toLowerCase();
    for (const word of ["kill", "block", "quarantine", "isolate", "unisolate", "restore"]) {
      expect(text, word).not.toContain(word);
    }
    await startInvestigating(page);
    await card(page).getByLabel("Assignee").selectOption("Analyst 3");
    await expect(headerAssignee(page)).toHaveText("Analyst 3");
    expect(sent.every((s) => s.includes("/case"))).toBe(true);
    expect(sent.some((s) => s.includes("/response") || s.includes("/ai/"))).toBe(false);
  });
});

test.describe("case UI (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("9. inc-1006 shows Open and Unassigned and sends no mutation", async ({ page }) => {
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "inc-1006");
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "open");
    await expect(card(page).getByLabel("Assignee")).toHaveValue("Unassigned");
    await expect(headerStatus(page)).toHaveAttribute("data-status", "open");
    await expect(headerAssignee(page)).toHaveText("Unassigned");
    await page.waitForTimeout(1500);
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
