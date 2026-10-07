import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { E2E_DATA_ROOT } from "../playwright.config";

// Wording of the two note fields: the Resolve dialog's resolution note and the
// activity card's note box, plus the label on a resolved event's note.

const REALISTIC = Boolean(process.env.E2E_REALISTIC);
const CASES_FILE = path.join(E2E_DATA_ROOT, "cases.json");
// Real writes only to inc-0001 and inc-0005, like the other case specs.
const DIALOG_INC = "inc-0001";
const TIMELINE_INC = "inc-0005";

const DIALOG_LABEL = "Resolution note (optional)";
const DIALOG_HELP = "Why did you reach this verdict? It appears in the case activity and in the incident report.";
const DIALOG_HINT = "Saying why helps tune the detection rule.";
const NOTEBOX_HELP = "Notes while you investigate. Resolve the case to write the resolution note.";

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

// The backend must be the one Playwright started with DATA_ROOT redirected.
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

function trackIssues(page: Page): () => string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return () => issues;
}

const card = (page: Page) => page.getByTestId("case-card");
const activity = (page: Page) => page.getByTestId("case-activity");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Resolve case" });

async function open(page: Page, id: string) {
  await page.goto(`/incidents/${id}`);
  await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
  await expect(activity(page)).toBeVisible();
}

async function openDialog(page: Page) {
  await card(page).getByRole("button", { name: "Resolve", exact: true }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("case note wording (default backend, temp DATA_ROOT)", () => {
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

  test("1. the Resolve dialog: label, helper text, optional, 1000 limit and counter", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page, DIALOG_INC);
    const dialog = await openDialog(page);

    const area = dialog.getByLabel(DIALOG_LABEL);
    await expect(area).toBeVisible();
    await expect(dialog.locator("label", { hasText: "Resolution note" })).toHaveText("Resolution note (optional)");
    await expect(dialog.getByTestId("resolve-note-help")).toHaveText(DIALOG_HELP);
    // the helper text describes the field for assistive technology
    await expect(area).toHaveAttribute("aria-describedby", /note-help/);

    // still optional: a verdict alone is enough to resolve
    await expect(dialog.getByRole("button", { name: "Resolve case" })).toBeDisabled();
    await dialog.getByRole("radio", { name: "True positive" }).check();
    await expect(dialog.getByRole("button", { name: "Resolve case" })).toBeEnabled();

    // limit and counter are unchanged
    await expect(area).toHaveAttribute("maxlength", "1000");
    await expect(dialog.getByText("0 / 1000")).toBeVisible();
    await area.fill("x".repeat(1200));
    await expect(dialog.getByText("1000 / 1000")).toBeVisible();
    await expect(area).toHaveValue("x".repeat(1000));

    // the old label is gone
    await expect(dialog.getByText("Note (optional)", { exact: true })).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("2. the false-positive hint shows only for false positive and benign activity", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page, DIALOG_INC);
    const dialog = await openDialog(page);
    const hint = dialog.getByTestId("resolve-note-hint");

    await expect(hint).toHaveCount(0); // no verdict chosen yet
    const expected: [string, boolean][] = [
      ["True positive", false],
      ["False positive", true],
      ["Undetermined", false],
      ["Benign activity", true],
      ["True positive", false],
    ];
    for (const [verdict, shown] of expected) {
      await dialog.getByRole("radio", { name: verdict }).check();
      if (shown) {
        await expect(hint, verdict).toHaveText(DIALOG_HINT);
        await expect(dialog.getByTestId("resolve-note-help")).toHaveText(DIALOG_HELP); // the helper stays
        await expect(dialog.getByLabel(DIALOG_LABEL)).toHaveAttribute("aria-describedby", /note-hint/);
      } else {
        await expect(hint, verdict).toHaveCount(0);
      }
    }
    expect(issues()).toEqual([]);
  });

  test("3. the note box keeps its label and has a helper line under it", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page, DIALOG_INC);
    const box = activity(page);
    await expect(box.locator("label", { hasText: "Add a note" })).toHaveText("Add a note");
    await expect(box.getByLabel("Add a note")).toBeVisible();
    const help = box.getByTestId("note-help");
    await expect(help).toHaveText(NOTEBOX_HELP);
    await expect(box.getByLabel("Add a note")).toHaveAttribute("aria-describedby", /help/);

    // the helper sits under the label and above the field
    const label = await box.locator("label", { hasText: "Add a note" }).boundingBox();
    const helpBox = await help.boundingBox();
    const area = await box.getByLabel("Add a note").boundingBox();
    expect(label && helpBox && area).toBeTruthy();
    expect(helpBox!.y).toBeGreaterThanOrEqual(label!.y + label!.height - 1);
    expect(area!.y).toBeGreaterThanOrEqual(helpBox!.y + helpBox!.height - 1);
    expect(issues()).toEqual([]);
  });

  test("4. a resolution note shows under the resolved event with its label; a note box note does not", async ({ page }) => {
    const issues = trackIssues(page);
    await open(page, TIMELINE_INC);

    // a note through the note box
    await activity(page).getByLabel("Add a note").fill("Checked the parent process.");
    await activity(page).getByRole("button", { name: "Add note" }).click();
    await expect(activity(page).locator('[data-type="note_added"]')).toHaveCount(1);

    // resolve with a note typed in the dialog
    const dialog = await openDialog(page);
    await dialog.getByRole("radio", { name: "False positive" }).check();
    await dialog.getByLabel(DIALOG_LABEL).fill("Scheduled admin script, expected.");
    await dialog.getByRole("button", { name: "Resolve case" }).click();
    await expect(dialog).toBeHidden();

    const resolved = activity(page).locator('[data-type="resolved"]');
    await expect(resolved).toHaveCount(1);
    await expect(resolved.getByTestId("case-event-note-label")).toHaveText("Resolution note");
    await expect(resolved.getByTestId("case-event-note")).toHaveText("Scheduled admin script, expected.");
    // the label sits above the text
    const labelBox = await resolved.getByTestId("case-event-note-label").boundingBox();
    const noteBox = await resolved.getByTestId("case-event-note").boundingBox();
    expect(noteBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height - 1);

    // the note box note: exact text, no label
    const noted = activity(page).locator('[data-type="note_added"]');
    await expect(noted.getByTestId("case-event-note")).toHaveText("Checked the parent process.");
    await expect(noted.getByTestId("case-event-note-label")).toHaveCount(0);
    await expect(noted).not.toContainText("Resolution note");

    // exactly one label on the card, and it survives a reload
    await page.reload();
    await expect(activity(page).getByTestId("case-event-note-label")).toHaveCount(1);
    await expect(activity(page).locator('[data-type="resolved"]').getByTestId("case-event-note-label")).toHaveText("Resolution note");
    expect(issues()).toEqual([]);
  });

  test("5. a resolved event with no note has no note block and no label", async ({ page }) => {
    const issues = trackIssues(page);
    const res = await page.request.post(`/api/incidents/${DIALOG_INC}/case/resolve`, {
      data: { verdict: "true_positive" },
      headers: { "x-actor": "Tester" },
    });
    expect(res.status()).toBe(200);
    await open(page, DIALOG_INC);
    const resolved = activity(page).locator('[data-type="resolved"]');
    await expect(resolved).toHaveCount(1);
    await expect(resolved.getByTestId("case-event-note")).toHaveCount(0);
    await expect(resolved.getByTestId("case-event-note-label")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("6. markup in a resolution note is plain text and carries the label", async ({ page }) => {
    const issues = trackIssues(page);
    const text = "<b>bold</b> **x** [a](javascript:alert(1))";
    const res = await page.request.post(`/api/incidents/${TIMELINE_INC}/case/resolve`, {
      data: { verdict: "benign_activity", note: text },
      headers: { "x-actor": "Tester" },
    });
    expect(res.status()).toBe(200);
    await open(page, TIMELINE_INC);
    const resolved = activity(page).locator('[data-type="resolved"]');
    await expect(resolved.getByTestId("case-event-note")).toHaveText(text);
    await expect(resolved.getByTestId("case-event-note-label")).toHaveText("Resolution note");
    await expect(resolved.locator("b, a")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });
});
