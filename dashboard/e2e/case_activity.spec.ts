import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { eventSentence } from "../lib/caseDisplay";
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

interface ApiCase {
  status: string;
  version: number;
  verdict: string | null;
  events: { id: string; type: string; actor: string; time: string; data: Record<string, unknown> }[];
}

async function apiCase(page: Page, id = INC): Promise<ApiCase> {
  const res = await page.request.get(`/api/incidents/${id}/case`);
  expect(res.status()).toBe(200);
  return (await res.json()) as ApiCase;
}

const card = (page: Page) => page.getByTestId("case-card");
const activity = (page: Page) => page.getByTestId("case-activity");
const events = (page: Page) => activity(page).getByTestId("case-event");
const sentences = (page: Page) => activity(page).getByTestId("case-event-sentence");
const noteArea = (page: Page) => activity(page).getByLabel("Add a note");

async function open(page: Page, id = INC, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(`/incidents/${id}`);
  await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
  await expect(activity(page)).toBeVisible();
}

async function addNote(page: Page, text: string) {
  await noteArea(page).fill(text);
  await activity(page).getByRole("button", { name: "Add note" }).click();
}

test.describe("case activity and notes (default backend, temp DATA_ROOT)", () => {
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

  test("1. Resolve from Open writes a resolved event and no status change", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page);
    await expect(card(page).getByRole("button", { name: "Start investigating" })).toBeVisible();
    const resolve = card(page).getByRole("button", { name: "Resolve", exact: true });
    await expect(resolve).toBeVisible();
    await resolve.click();
    const dialog = page.getByRole("dialog", { name: "Resolve case" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Benign activity" }).check();
    await dialog.getByRole("button", { name: "Resolve case" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "resolved");
    await expect(page.getByTestId("case-verdict")).toHaveText("Benign activity");

    const body = await apiCase(page);
    expect(body.events.map((e) => e.type)).toEqual(["created", "resolved"]);
    expect(body.version).toBe(2);
    expect(body.verdict).toBe("benign_activity");
    expect(issues()).toEqual([]);
  });

  test("1b. the Open state keeps Start investigating as the primary action", async ({ page }) => {
    await open(page);
    const start = card(page).getByRole("button", { name: "Start investigating" });
    const resolve = card(page).getByRole("button", { name: "Resolve", exact: true });
    const [startBg, resolveBg] = await Promise.all([
      start.evaluate((el) => getComputedStyle(el).backgroundColor),
      resolve.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(startBg).not.toBe(resolveBg);
    // Cancelling the dialog from the Open state changes nothing and returns focus
    await resolve.click();
    await page.keyboard.press("Escape");
    await expect(resolve).toBeFocused();
    expect((await apiCase(page)).version).toBe(0);
  });

  test("2. notes: add, clear, keep focus, counter, shortcut, plain text, limits, persistence", async ({ page }) => {
    const issues = trackIssues(page);
    page.on("dialog", (d) => {
      issues().push(`dialog: ${d.message()}`);
      void d.dismiss();
    });
    await open(page);
    const addButton = activity(page).getByRole("button", { name: "Add note" });

    // empty and whitespace-only notes are never sent
    await expect(addButton).toBeDisabled();
    await noteArea(page).fill("   \n\t  ");
    await expect(addButton).toBeDisabled();
    await noteArea(page).fill("");
    await expect(activity(page).getByTestId("note-counter")).toHaveText("0 / 2000");

    // counter, submit, cleared and focused
    await noteArea(page).fill("Checked it");
    await expect(activity(page).getByTestId("note-counter")).toHaveText("10 / 2000");
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(sentences(page).first()).toHaveText("Analyst added a note");
    await expect(activity(page).getByTestId("case-event-note").first()).toHaveText("Checked it");
    await expect(noteArea(page)).toHaveValue("");
    await expect(noteArea(page)).toBeFocused();
    await expect(addButton).toBeDisabled();

    // Ctrl+Enter submits
    await noteArea(page).fill("Second note");
    await noteArea(page).press("Control+Enter");
    await expect(activity(page).getByTestId("case-event-note").first()).toHaveText("Second note");
    await expect(noteArea(page)).toHaveValue("");
    await expect(noteArea(page)).toBeFocused();

    // markup is literal text
    const markup = "<img src=x onerror=alert(1)> <b>bold</b> & <script>alert(2)</script>";
    await addNote(page, markup);
    await expect(activity(page).getByTestId("case-event-note").first()).toHaveText(markup);
    await expect(activity(page).locator("img, b, script")).toHaveCount(0);
    await expect(page.locator("main img[src='x']")).toHaveCount(0);

    // multi-line notes keep their line breaks
    await addNote(page, "line one\nline two");
    const multi = activity(page).getByTestId("case-event-note").first();
    await expect(multi).toHaveText("line one\nline two");
    await expect(multi).toHaveCSS("white-space", "pre-wrap");

    // 2000 characters are accepted
    await addNote(page, "a".repeat(2000));
    await expect(activity(page).getByTestId("case-event-note").first()).toHaveText("a".repeat(2000));

    // a 2001 character paste is cut at 2000
    await noteArea(page).focus();
    await page.keyboard.insertText("b".repeat(2001));
    await expect(noteArea(page)).toHaveValue("b".repeat(2000));
    await expect(activity(page).getByTestId("note-counter")).toHaveText("2000 / 2000");
    await noteArea(page).fill("");

    // persisted
    const body = await apiCase(page);
    expect(body.events.map((e) => e.type)).toEqual([
      "created", "note_added", "note_added", "note_added", "note_added", "note_added",
    ]);
    expect(body.events[3].data).toEqual({ text: markup });
    await page.reload();
    await expect(activity(page)).toBeVisible();
    await expect(activity(page).getByTestId("case-event-note").nth(1)).toHaveText("line one\nline two");
    await expect(activity(page).locator("img")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("2b. the note is sent under the recorded-as name", async ({ page }) => {
    await open(page);
    await card(page).getByRole("button", { name: "Change" }).click();
    await card(page).getByLabel("Your name").fill("Priya");
    await card(page).getByLabel("Your name").press("Enter");
    await addNote(page, "from Priya");
    await expect(sentences(page).first()).toHaveText("Priya added a note");
    expect((await apiCase(page)).events[1].actor).toBe("Priya");
  });

  test("3. timeline: newest first, sentences, Case opened last, Show all, resolution note", async ({ page }) => {
    const issues = trackIssues(page);
    const post = (sub: string, data: Record<string, unknown>) =>
      page.request.post(`${CASE_URL}/${sub}`, { data, headers: { "x-actor": "Sam" } });
    // an incident with no events shows the empty state
    await open(page, "inc-0002");
    await expect(activity(page).getByTestId("case-activity-empty")).toHaveText(
      "No activity yet. Notes and status changes appear here.",
    );
    await expect(activity(page).getByTestId("case-activity-count")).toHaveText("0 events");
    await expect(events(page)).toHaveCount(0);
    await expect(activity(page).getByRole("button", { name: /Show all/ })).toHaveCount(0);

    // build a case of 8 events
    expect((await post("notes", { text: "first look" })).status()).toBe(200);
    expect((await post("notes", { text: "checked the parent process" })).status()).toBe(200);
    expect((await page.request.patch(CASE_URL, { data: { assignee: "Analyst 1" }, headers: { "x-actor": "Sam" } })).status()).toBe(200);
    expect((await page.request.patch(CASE_URL, { data: { status: "investigating" }, headers: { "x-actor": "Sam" } })).status()).toBe(200);
    expect((await post("notes", { text: "third note" })).status()).toBe(200);
    expect((await post("resolve", { verdict: "false_positive", note: "Verified admin script" })).status()).toBe(200);
    expect((await post("reopen", {})).status()).toBe(200);
    const body = await apiCase(page);
    expect(body.events.length).toBe(8);

    await open(page);
    await expect(activity(page).getByTestId("case-activity-count")).toHaveText("8 events");
    // collapsed: the 6 newest
    await expect(events(page)).toHaveCount(6);
    await expect(activity(page).getByRole("button", { name: "Show all 8 events" })).toBeVisible();
    // the same button flips its label when expanded, so find it by its state attribute
    const toggle = activity(page).locator("button[aria-expanded]");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toHaveCount(1);

    const newestFirst = [...body.events].reverse();
    expect(await sentences(page).allInnerTexts()).toEqual(newestFirst.slice(0, 6).map((e) => eventSentence(e)));

    // expanded: everything, newest first, Case opened last
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(events(page)).toHaveCount(8);
    expect(await sentences(page).allInnerTexts()).toEqual(newestFirst.map((e) => eventSentence(e)));
    await expect(sentences(page).last()).toHaveText("Case opened");
    await expect(sentences(page).first()).toHaveText("Sam reopened this case");
    await expect(activity(page).getByRole("button", { name: "Show fewer events" })).toBeVisible();

    // notes and the resolution note are shown under their events
    const resolvedRow = events(page).filter({ hasText: "Sam resolved this as false positive" });
    await expect(resolvedRow.getByTestId("case-event-note")).toHaveText("Verified admin script");
    await expect(events(page).filter({ hasText: "Sam added a note" }).getByTestId("case-event-note")).toHaveText([
      "third note",
      "checked the parent process",
      "first look",
    ]);
    // every row has a time with the UTC time in its title
    const titles = await activity(page).locator("time").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    expect(titles.length).toBe(8);
    for (const t of titles) expect(t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);

    await activity(page).getByRole("button", { name: "Show fewer events" }).click();
    await expect(events(page)).toHaveCount(6);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(issues()).toEqual([]);
  });

  test("4. conflict: a note sent after someone else changed the case", async ({ page }) => {
    const issues = trackIssues(page, [409]);
    await open(page);
    expect(
      (await page.request.post(`${CASE_URL}/notes`, { data: { text: "from another analyst" }, headers: { "x-actor": "Sam" } })).status(),
    ).toBe(200);

    await noteArea(page).fill("my note");
    await activity(page).getByRole("button", { name: "Add note" }).click();
    await expect(activity(page).getByRole("alert").filter({ hasText: "This case was changed by someone else. Showing the latest version." })).toBeVisible();
    await expect(page.getByTestId("case-conflict")).toBeVisible();
    // the timeline shows the latest events and the unsent text is kept
    await expect(sentences(page).first()).toHaveText("Sam added a note");
    await expect(activity(page).getByTestId("case-event-note").first()).toHaveText("from another analyst");
    await expect(noteArea(page)).toHaveValue("my note");
    expect((await apiCase(page)).events.length).toBe(2); // created + the other analyst's note

    // sending again now works and clears the message
    await activity(page).getByRole("button", { name: "Add note" }).click();
    await expect(sentences(page).first()).toHaveText("Analyst added a note");
    await expect(noteArea(page)).toHaveValue("");
    await expect(activity(page).getByRole("alert").filter({ hasText: "changed by someone else" })).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("4b. an unavailable case service shows a notice and keeps the typed note", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    await open(page);
    await page.route("**/api/incidents/*/case/notes", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await noteArea(page).fill("not lost");
    await activity(page).getByRole("button", { name: "Add note" }).click();
    await expect(activity(page).getByRole("alert").filter({ hasText: "Case data is unavailable right now" })).toBeVisible();
    await expect(noteArea(page)).toHaveValue("not lost");
    await expect(noteArea(page)).toBeFocused();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await activity(page).getByRole("button", { name: "Add note" }).click();
    await expect(sentences(page).first()).toHaveText("Analyst added a note");
    expect(issues()).toEqual([]);
  });

  test("5. the activity card sits directly below the AI triage card", async ({ page }) => {
    await open(page);
    const order = await page.evaluate(() => {
      const column = document.querySelector("main > div.grid > div:first-child") as HTMLElement;
      return Array.from(column.children).map((c) => c.getAttribute("data-testid") ?? c.querySelector("h3")?.textContent ?? "");
    });
    expect(order[1]).toBe("case-activity");
    const boxes = await Promise.all([
      page.locator("main > div.grid > div:first-child > div").first().boundingBox(),
      activity(page).boundingBox(),
    ]);
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  });

  test("7. the Details card says Not classified for a null scenario", async ({ page }) => {
    const issues = trackIssues(page);
    const scenario = (p: Page) => p.locator("dt:has-text('Scenario') + dd");
    await open(page, "inc-0001");
    await expect(scenario(page)).toHaveText("Not classified");
    await expect(scenario(page).locator("span")).toHaveClass(/text-ink-subtle/);
    // the page title logic is unchanged
    await expect(page.locator("h1")).not.toHaveText("Not classified");
    await open(page, "inc-0003");
    await expect(scenario(page)).toHaveText("Credential dump chain");
    await open(page, "inc-0002");
    await expect(scenario(page)).toHaveText("Malware drop chain");
    expect(issues()).toEqual([]);
  });

  test("9. no horizontal scroll on the incident page at 1440 and 390", async ({ page }) => {
    const issues = trackIssues(page);
    await page.request.post(`${CASE_URL}/notes`, { data: { text: "x".repeat(400) + " " + "y".repeat(300) } });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => {
        const a = document.querySelector('[data-testid="case-activity"]') as HTMLElement;
        const scroller = document.querySelector("body > div > div:last-child") as HTMLElement;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          activity: a.scrollWidth - a.clientWidth,
          scroller: scroller.scrollWidth - scroller.clientWidth,
        };
      });
      expect(overflow.doc, `${width}px document`).toBeLessThanOrEqual(0);
      expect(overflow.activity, `${width}px activity`).toBeLessThanOrEqual(0);
    }
    expect(issues()).toEqual([]);
  });

  test("10. screenshots: activity with events (light and dark), the empty state and 390 wide", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "inc-0002");
    expectUsable(await shot(activity(page), "case-activity-empty-light-1440.png"));

    const post = (sub: string, data: Record<string, unknown>) =>
      page.request.post(`${CASE_URL}/${sub}`, { data, headers: { "x-actor": "Priya" } });
    await post("notes", { text: "Word spawned PowerShell with an encoded command. Checking the dropped file." });
    await page.request.patch(CASE_URL, { data: { assignee: "Analyst 1", status: "investigating" }, headers: { "x-actor": "Priya" } });
    await post("notes", { text: "Parent chain matches the phishing scenario." });

    await open(page, INC, "light");
    await expect(events(page)).toHaveCount(5); // created, note, assignee, status, note
    expectUsable(await shot(activity(page), "case-activity-events-light-1440.png"));
    await open(page, INC, "dark");
    expectUsable(await shot(activity(page), "case-activity-events-dark-1440.png"));

    await page.setViewportSize({ width: 390, height: 2400 });
    await open(page, INC, "light");
    expectUsable(await shot(page.locator("main > div.pb-4").first(), "case-header-light-390.png"));
    expectUsable(await shot(card(page), "case-card-light-390.png"));
    expectUsable(await shot(activity(page), "case-activity-events-light-390.png"));
    expect(issues()).toEqual([]);
  });
});
