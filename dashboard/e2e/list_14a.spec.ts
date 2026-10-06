import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { disagrees, sideOfAi, sideOfAnalyst } from "../lib/caseJoin";
import { incidentListTitle, incidentMeta } from "../lib/incidentListTitle";
import { formatShortDateTime, formatUtc } from "../lib/time";
import { E2E_DATA_ROOT } from "../playwright.config";

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

const AI_VERDICTS = ["true_positive", "likely_true_positive", "false_positive", "likely_false_positive", "needs_review"];
const ANALYST_VERDICTS = ["true_positive", "false_positive", "benign_activity", "undetermined"];
const ODD = [null, undefined, "", "mystery", 5, {}, []];

test.describe("verdict sides: unit", () => {
  test("sideOfAi", () => {
    const expected: Record<string, string> = {
      true_positive: "malicious",
      likely_true_positive: "malicious",
      false_positive: "benign",
      likely_false_positive: "benign",
      needs_review: "uncertain",
    };
    for (const [verdict, side] of Object.entries(expected)) expect(sideOfAi(verdict), verdict).toBe(side);
    for (const odd of [...ODD, "benign_activity", "undetermined"]) expect(sideOfAi(odd), String(odd)).toBeNull();
  });

  test("sideOfAnalyst", () => {
    expect(sideOfAnalyst("true_positive")).toBe("malicious");
    expect(sideOfAnalyst("false_positive")).toBe("benign");
    expect(sideOfAnalyst("benign_activity")).toBe("benign");
    for (const odd of [...ODD, "undetermined", "likely_true_positive", "needs_review"]) {
      expect(sideOfAnalyst(odd), String(odd)).toBeNull();
    }
  });

  test("disagrees for every AI verdict by every analyst verdict", () => {
    const aiMalicious = ["true_positive", "likely_true_positive"];
    const aiBenign = ["false_positive", "likely_false_positive"];
    const analystMalicious = ["true_positive"];
    const analystBenign = ["false_positive", "benign_activity"];
    for (const ai of AI_VERDICTS) {
      for (const analyst of ANALYST_VERDICTS) {
        const expected =
          (aiMalicious.includes(ai) && analystBenign.includes(analyst)) ||
          (aiBenign.includes(ai) && analystMalicious.includes(analyst));
        expect(disagrees(ai, analyst), `${ai} vs ${analyst}`).toBe(expected);
      }
    }
    // spot checks written out
    expect(disagrees("likely_true_positive", "false_positive")).toBe(true);
    expect(disagrees("true_positive", "true_positive")).toBe(false);
    expect(disagrees("needs_review", "true_positive")).toBe(false);
    expect(disagrees("needs_review", "false_positive")).toBe(false);
    expect(disagrees("false_positive", "undetermined")).toBe(false);
  });

  test("disagrees is false whenever a verdict is missing or unknown", () => {
    for (const odd of ODD) {
      for (const verdict of [...AI_VERDICTS, ...ANALYST_VERDICTS]) {
        expect(disagrees(odd, verdict), `${String(odd)} vs ${verdict}`).toBe(false);
        expect(disagrees(verdict, odd), `${verdict} vs ${String(odd)}`).toBe(false);
      }
      expect(disagrees(odd, odd)).toBe(false);
    }
  });
});

test.describe("incidentListTitle: unit", () => {
  const alerts = {
    a1: { title: "Late rule", timestamp: "2026-10-04T10:00:00.000Z" },
    a2: { title: "Early rule", timestamp: "2026-10-04T09:00:00.000Z" },
    a3: { title: "", timestamp: "2026-10-04T08:00:00.000Z" },
    a4: { title: "   ", timestamp: "2026-10-04T07:00:00.000Z" },
    a5: { title: "Same time first", timestamp: "2026-10-04T06:00:00.000Z" },
    a6: { title: "Same time second", timestamp: "2026-10-04T06:00:00.000Z" },
    a7: { title: "No time" },
    a8: { title: "Offset time", timestamp: "2026-10-04T10:30:00.000+07:00" }, // 03:30Z
  };
  const none = { matched_scenario: null, techniques: [] as string[] };

  test("the scenario wins and is humanized", () => {
    expect(incidentListTitle({ ...none, matched_scenario: "credential_dump_chain", alert_ids: ["a2"] }, alerts)).toBe(
      "Credential dump chain",
    );
    expect(incidentListTitle({ ...none, matched_scenario: "  malware_drop_chain " }, null)).toBe("Malware drop chain");
    expect(incidentListTitle({ ...none, matched_scenario: "x" }, null)).toBe("X");
  });

  test("otherwise the earliest alert's rule title, by timestamp", () => {
    expect(incidentListTitle({ ...none, alert_ids: ["a1", "a2"] }, alerts)).toBe("Early rule");
    expect(incidentListTitle({ ...none, alert_ids: ["a2", "a1"] }, alerts)).toBe("Early rule");
    // real instants, not text: 10:30+07:00 is 03:30Z, earlier than 09:00Z
    expect(incidentListTitle({ ...none, alert_ids: ["a2", "a8"] }, alerts)).toBe("Offset time");
  });

  test("ties keep input order; empty and blank titles are skipped; no time sorts last", () => {
    expect(incidentListTitle({ ...none, alert_ids: ["a5", "a6"] }, alerts)).toBe("Same time first");
    expect(incidentListTitle({ ...none, alert_ids: ["a6", "a5"] }, alerts)).toBe("Same time second");
    // a3 and a4 are the earliest but have no usable title
    expect(incidentListTitle({ ...none, alert_ids: ["a3", "a4", "a1"] }, alerts)).toBe("Late rule");
    expect(incidentListTitle({ ...none, alert_ids: ["a7", "a1"] }, alerts)).toBe("Late rule");
    expect(incidentListTitle({ ...none, alert_ids: ["a7"] }, alerts)).toBe("No time");
    expect(incidentListTitle({ ...none, alert_ids: ["missing", "a2"] }, alerts)).toBe("Early rule");
  });

  test("then the first technique, then Incident", () => {
    expect(incidentListTitle({ ...none, alert_ids: ["a3"], techniques: ["T1059.001", "T1105"] }, alerts)).toBe("Technique T1059.001");
    expect(incidentListTitle({ ...none, alert_ids: ["a1"], techniques: ["T1003"] }, null)).toBe("Technique T1003");
    expect(incidentListTitle({ ...none, techniques: ["T1003"] }, {})).toBe("Technique T1003");
    expect(incidentListTitle({ ...none, techniques: ["", "T1003"] }, null)).toBe("Incident");
    expect(incidentListTitle({ ...none }, null)).toBe("Incident");
    expect(incidentListTitle({ matched_scenario: null, alert_ids: [], techniques: [] }, alerts)).toBe("Incident");
  });

  test("never throws on garbage", () => {
    const garbage = [null, undefined, 5, "x", [], {}, { alert_ids: 5 }, { alert_ids: [null, 5, {}], techniques: "T1" }, { techniques: [5] }];
    const maps = [null, undefined, "x", 5, [], { a: null }, { a: 5 }, { a: { title: 5, timestamp: 5 } }, alerts];
    for (const incident of garbage) {
      for (const map of maps) {
        expect(() => incidentListTitle(incident as never, map as never)).not.toThrow();
        expect(typeof incidentListTitle(incident as never, map as never)).toBe("string");
        expect(incidentListTitle(incident as never, map as never)).not.toBe("");
      }
    }
  });
});

test.describe("incidentMeta: unit", () => {
  test("host, user and a counted alert phrase", () => {
    expect(incidentMeta("WS01", "CORP\\alice", 2)).toBe("WS01 · CORP\\alice · 2 alerts");
    expect(incidentMeta("WS01", "CORP\\alice", 1)).toBe("WS01 · CORP\\alice · 1 alert");
    expect(incidentMeta("WS01", "CORP\\alice", 0)).toBe("WS01 · CORP\\alice · 0 alerts");
  });

  test("a missing part is left out cleanly", () => {
    expect(incidentMeta("WS01", null, 3)).toBe("WS01 · 3 alerts");
    expect(incidentMeta(undefined, "CORP\\alice", 1)).toBe("CORP\\alice · 1 alert");
    expect(incidentMeta("", "  ", 2)).toBe("2 alerts");
    expect(incidentMeta("WS01", "CORP\\alice", undefined)).toBe("WS01 · CORP\\alice");
    expect(incidentMeta(null, null, null)).toBe("");
    expect(incidentMeta(5, {}, Number.NaN)).toBe("");
  });
});

test.describe("formatShortDateTime: unit", () => {
  test("day, month and 24 hour time in the zone", () => {
    expect(formatShortDateTime("2026-10-04T09:41:05.000Z", "UTC")).toBe("04 Oct, 09:41");
    expect(formatShortDateTime("2026-10-04T09:41:05.000Z", "Asia/Phnom_Penh")).toBe("04 Oct, 16:41");
    expect(formatShortDateTime("2026-10-04T16:41:59Z", "UTC")).toBe("04 Oct, 16:41"); // no seconds
    expect(formatShortDateTime("2026-10-04T09:05:00+00:00", "UTC")).toBe("04 Oct, 09:05");
  });

  test("the date rolls over with the zone", () => {
    expect(formatShortDateTime("2026-10-04T18:30:00Z", "Asia/Phnom_Penh")).toBe("05 Oct, 01:30");
    expect(formatShortDateTime("2026-12-31T20:00:00Z", "Asia/Phnom_Penh")).toBe("01 Jan, 03:00");
    expect(formatShortDateTime("2026-10-05T02:15:00Z", "America/Los_Angeles")).toBe("04 Oct, 19:15");
    expect(formatShortDateTime("2026-10-04T17:00:00Z", "Asia/Phnom_Penh")).toBe("05 Oct, 00:00"); // midnight reads 00, not 24
  });

  test("bad input reads Unknown", () => {
    for (const bad of ["", "not a date", null, undefined, "2026-13-45"]) {
      expect(formatShortDateTime(bad as never, "UTC"), String(bad)).toBe("Unknown");
    }
  });
});

// ---------------------------------------------------------------------------
// Browser helpers

interface ApiIncident {
  incident_id: string;
  severity: string;
  host: string;
  user: string;
  matched_scenario: string | null;
  techniques: string[];
  alert_ids: string[];
  incident_raised_time: string;
  triage_verdict: string | null;
  triage_status: string | null;
}

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
async function shot(target: Locator | Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await target.screenshot({ path: file });
  const size = pngSize(file);
  console.log(`${name} ${size.width}x${size.height}`);
  return size;
}

function expectUsable(size: { width: number; height: number }) {
  expect(size.width).toBeGreaterThan(40);
  expect(size.height).toBeGreaterThan(40);
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

async function apiIncidents(page: Page): Promise<ApiIncident[]> {
  const res = await page.request.get("/api/incidents?limit=500");
  expect(res.ok()).toBe(true);
  return (await res.json()) as ApiIncident[];
}

// The analyst verdict that lands on the OPPOSITE side of the AI's call, and one on the SAME side.
// Derived from the API data, never hard-coded.
function oppositeVerdict(aiVerdict: string | null): string {
  const side = sideOfAi(aiVerdict);
  expect(["malicious", "benign"], `AI verdict ${aiVerdict} must have a side`).toContain(side);
  return side === "malicious" ? "false_positive" : "true_positive";
}
function sameVerdict(aiVerdict: string | null): string {
  const side = sideOfAi(aiVerdict);
  expect(["malicious", "benign"], `AI verdict ${aiVerdict} must have a side`).toContain(side);
  return side === "malicious" ? "true_positive" : "false_positive";
}

const row = (page: Page, id: string) => page.locator(`tbody tr[data-incident-id="${id}"]`);
const rows = (page: Page) => page.locator("tbody tr[data-incident-id]");
const showing = (page: Page) => page.getByText(/Showing \d+ of \d+ incidents/);
const filterSelect = (page: Page, caption: "Status" | "Assignee") =>
  page.locator("label").filter({ has: page.locator("span", { hasText: new RegExp(`^${caption}$`) }) }).locator("select");

async function rowIds(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-incident-id") ?? ""));
}

async function openList(page: Page, theme: "light" | "dark" = "light", query = "") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(`/incidents${query}`);
  await page.waitForSelector("[data-incident-id]", { state: "attached", timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("div.h-screen.min-w-0.flex-1.overflow-y-auto");
    const table = document.querySelector('[data-testid="incidents-table-container"]');
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      table: table ? table.scrollWidth - table.clientWidth : 0,
    };
  });
}

const AI_TOOLTIP = "AI verdict. Advisory only: it never changes detections or response actions.";

// ---------------------------------------------------------------------------
// Default backend, temp DATA_ROOT

test.describe("incident list (default backend, temp DATA_ROOT)", () => {
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

  test("2. structure: six columns, fixed 52px rows, no sideways scroll, short times, real titles", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);

    const headers = (await page.locator("thead th").allInnerTexts()).map((h) => h.replace(/[▲▼⇅]/g, "").trim());
    expect(headers.slice(0, 6)).toEqual(["Severity", "Incident", "Raised", "Triage", "Status", "Assignee"]);
    expect(headers.slice(6).every((h) => h === "")).toBe(true); // only the chevron cell follows
    for (const gone of ["Scenario", "Host", "User", "Alerts", "Last action"]) {
      await expect(page.locator("thead th", { hasText: new RegExp(`^\\s*${gone}`) }), gone).toHaveCount(0);
    }

    const incidents = await apiIncidents(page);
    expect((await rowIds(page)).length).toBe(incidents.length);
    const alerts = (await (await page.request.get("/api/alerts?limit=500")).json()) as { rule_title: string }[];
    const ruleTitles = new Set(alerts.map((a) => a.rule_title));

    for (const [width, height] of [
      [1440, 900],
      [1024, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(heights.length).toBe(incidents.length);
      for (const h of heights) expect(h, `row height at ${width}px`).toBe(52);
    }

    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const o = await overflow(page);
      expect(o.doc, `${width}px document`).toBeLessThanOrEqual(0);
      expect(o.scroller, `${width}px scroller`).toBeLessThanOrEqual(0);
      expect(o.table, `${width}px table container`).toBeLessThanOrEqual(0);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const tableText = await page.locator("tbody").innerText();
    expect(tableText).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);

    for (const inc of incidents) {
      const r = row(page, inc.incident_id);
      const raised = r.getByTestId("cell-raised");
      await expect(raised, inc.incident_id).toHaveText(formatShortDateTime(inc.incident_raised_time));
      expect((await raised.getAttribute("title")) ?? "").toContain(formatUtc(inc.incident_raised_time));
      await expect(raised).toHaveCSS("text-align", "right");

      const title = (await r.getByTestId("cell-incident-title").innerText()).trim();
      expect(title.length, inc.incident_id).toBeGreaterThan(0);
      expect(await r.getByTestId("cell-incident-title").getAttribute("title")).toBe(title);
      expect(title).not.toBe("-");
      if (inc.matched_scenario === null) {
        // unclassified incidents show a rule title or a technique, never a dash or the bare fallback
        expect(title === "Incident" ? "bare fallback" : "ok", inc.incident_id).toBe("ok");
        expect(title.startsWith("Technique ") || ruleTitles.has(title), `${inc.incident_id}: ${title}`).toBe(true);
      }
      const meta = (await r.getByTestId("cell-incident-meta").innerText()).trim();
      expect(meta).toBe(incidentMeta(inc.host, inc.user, inc.alert_ids.length));
    }
    expect(issues()).toEqual([]);
  });

  test("3. triage: the AI tag and tooltip, the analyst pill, the disagreement marker, undetermined", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const incidents = await apiIncidents(page);
    const byId = new Map(incidents.map((i) => [i.incident_id, i]));

    // 0001 gets the opposite side of the AI's call, 0005 the same side: derived from the API data
    const opposite = oppositeVerdict(byId.get("inc-0001")!.triage_verdict);
    const same = sameVerdict(byId.get("inc-0005")!.triage_verdict);
    expect((await resolveCase(page, "inc-0001", opposite)).status()).toBe(200);
    expect((await resolveCase(page, "inc-0005", same)).status()).toBe(200);
    // The third case, resolved as undetermined, rides in on the case list: real writes only go to 0001 and 0005.
    await page.route("**/api/cases", async (route) => {
      const res = await route.fetch();
      const list = (await res.json()) as Record<string, unknown>[];
      list.push({
        incident_id: "inc-0003", status: "resolved", assignee: null, verdict: "undetermined",
        updated_time: "2026-10-04T10:00:00.000Z", resolved_time: "2026-10-04T10:00:00.000Z", version: 2,
      });
      await route.fulfill({ response: res, json: list });
    });
    await openList(page);

    // every unresolved row's AI pill has the visible tag, the label and the tooltip;
    // a resolved row leads with the analyst's pill instead and has no AI pill
    const resolvedIds = ["inc-0001", "inc-0003", "inc-0005"];
    for (const inc of incidents) {
      const pill = row(page, inc.incident_id).locator('[data-source-tag="ai"]');
      if (resolvedIds.includes(inc.incident_id)) {
        await expect(pill, inc.incident_id).toHaveCount(0);
        continue;
      }
      await expect(pill, inc.incident_id).toBeVisible();
      await expect(pill.getByText("AI", { exact: true })).toBeVisible();
      expect(await pill.getAttribute("aria-label")).toMatch(/^AI verdict: /);
      expect(await pill.getAttribute("title")).toBe(await pill.getAttribute("aria-label"));
    }
    const firstPill = rows(page).first().locator('[data-source-tag="ai"]');
    await firstPill.hover();
    await expect(page.getByRole("tooltip")).toHaveText(AI_TOOLTIP);
    await page.mouse.move(5, 5);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // opposite side: the analyst pill with the person icon and the marker
    const r1 = row(page, "inc-0001");
    await expect(r1.getByTestId("analyst-verdict-pill")).toBeVisible();
    await expect(r1.getByTestId("analyst-verdict-pill").locator("svg.lucide-user-check")).toHaveCount(1);
    await expect(r1.getByTestId("disagreement-marker")).toHaveCount(1);
    await r1.getByTestId("disagreement-marker").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Analyst disagrees with the AI");
    await expect(r1.getByTestId("disagreement-marker")).toHaveAttribute("aria-label", "Analyst disagrees with the AI");
    await page.mouse.move(5, 5);

    // same side: the pill, no marker
    const r5 = row(page, "inc-0005");
    await expect(r5.getByTestId("analyst-verdict-pill")).toBeVisible();
    await expect(r5.getByTestId("disagreement-marker")).toHaveCount(0);

    // undetermined: the pill says so, no marker
    const r3 = row(page, "inc-0003");
    await expect(r3.getByTestId("analyst-verdict-pill")).toContainText("Undetermined");
    await expect(r3.getByTestId("disagreement-marker")).toHaveCount(0);

    // unresolved rows have no analyst pill
    for (const id of ["inc-0002", "inc-0004"]) {
      await expect(row(page, id).getByTestId("analyst-verdict-pill"), id).toHaveCount(0);
      await expect(row(page, id).getByTestId("disagreement-marker"), id).toHaveCount(0);
    }

    // every row is still 52px with or without the second line
    const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBe(52);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("4a. queue order: unresolved first, resolved last, newest first in each group", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const incidents = await apiIncidents(page);
    const newestFirst = [...incidents]
      .sort((a, b) => Date.parse(b.incident_raised_time) - Date.parse(a.incident_raised_time))
      .map((i) => i.incident_id);

    await openList(page);
    expect(await rowIds(page)).toEqual(newestFirst);
    await expect(page.getByTestId("queue-note")).toHaveText("Unresolved first, then newest");
    await expect(page.locator('thead [aria-label^="sorted"]')).toHaveCount(0);
    await expect(page.getByTestId("queue-order-button")).toHaveCount(0);

    // resolve one that is not last: it moves below every unresolved incident after the next poll
    const victim = newestFirst.find((id) => id === "inc-0001")!;
    expect((await resolveCase(page, victim, "true_positive")).status()).toBe(200);
    const expected = [...newestFirst.filter((id) => id !== victim), victim];
    await expect.poll(() => rowIds(page), { timeout: 15_000 }).toEqual(expected);
    await expect(page.getByTestId("queue-note")).toBeVisible();

    // a second resolved case: resolved incidents keep newest first among themselves
    expect((await resolveCase(page, "inc-0005", "false_positive")).status()).toBe(200);
    const resolved = new Set(["inc-0001", "inc-0005"]);
    const expected2 = [
      ...newestFirst.filter((id) => !resolved.has(id)),
      ...newestFirst.filter((id) => resolved.has(id)),
    ];
    await expect.poll(() => rowIds(page), { timeout: 15_000 }).toEqual(expected2);
    expect(issues()).toEqual([]);
  });

  test("4b. a header sort replaces the queue order, by the real timestamp, and Queue order restores it", async ({ page }) => {
    const issues = trackIssues(page);
    const real = (await (await page.request.get("/api/incidents?limit=5")).json()) as Record<string, unknown>[];
    const early = { ...real[0], incident_id: "mock-early", incident_raised_time: "2026-10-04T10:30:00.000+07:00" }; // 03:30Z
    const late = { ...real[1], incident_id: "mock-late", incident_raised_time: "2026-10-04T09:00:00.000Z" }; // 09:00Z
    await page.route(/\/api\/incidents(\?.*)?$/, (route) => route.fulfill({ json: [early, late] }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    await page.waitForSelector("tbody tr[data-incident-id]");

    // queue order: both unresolved, newest first (the text "...T09:00" sorts before "...T10:30", but 09:00Z is later)
    expect(await rowIds(page)).toEqual(["mock-late", "mock-early"]);
    await expect(page.getByTestId("queue-note")).toBeVisible();
    await expect(page.locator('thead [aria-label^="sorted"]')).toHaveCount(0);

    await page.locator("thead th", { hasText: "Raised" }).click();
    expect(await rowIds(page)).toEqual(["mock-early", "mock-late"]);
    await expect(page.locator('thead th', { hasText: "Raised" }).locator('[aria-label="sorted ascending"]')).toHaveCount(1);
    await expect(page.getByTestId("queue-note")).toHaveCount(0);
    const restore = page.getByRole("button", { name: "Queue order" });
    await expect(restore).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("raised");

    await page.locator("thead th", { hasText: "Raised" }).click();
    expect(await rowIds(page)).toEqual(["mock-late", "mock-early"]);

    await restore.click();
    expect(await rowIds(page)).toEqual(["mock-late", "mock-early"]);
    await expect(page.getByTestId("queue-note")).toHaveText("Unresolved first, then newest");
    await expect(page.locator('thead [aria-label^="sorted"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Queue order" })).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBeNull();

    // the other sortable headers work and show the arrow; Triage is not one of them
    for (const name of ["Severity", "Incident", "Status", "Assignee"]) {
      await page.locator("thead th", { hasText: new RegExp(`^\\s*${name}`) }).click();
      await expect(page.locator("thead th", { hasText: new RegExp(`^\\s*${name}`) }).locator('[aria-label^="sorted"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Queue order" })).toBeVisible();
      await page.getByRole("button", { name: "Queue order" }).click();
    }
    await page.locator("thead th", { hasText: /^\s*Triage/ }).click();
    await expect(page.getByTestId("queue-note")).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("5. search finds an incident by its displayed title; the filters and the count still work", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const incidents = await apiIncidents(page);
    await openList(page);

    // inc-0005 has no scenario: its title is a rule title
    const title = (await row(page, "inc-0005").getByTestId("cell-incident-title").innerText()).trim();
    expect(title.length).toBeGreaterThan(3);
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill(title.toLowerCase());
    expect(await rowIds(page)).toEqual(["inc-0005"]);
    await expect(showing(page)).toHaveText(`Showing 1 of ${incidents.length} incidents`);

    // host, user and the raw scenario still match
    await search.fill("ws03");
    expect(await rowIds(page)).toEqual(["inc-0001"]);
    await search.fill("alice");
    expect(await rowIds(page)).toEqual(["inc-0003"]);
    await search.fill("credential_dump");
    expect(await rowIds(page)).toEqual(["inc-0003"]);
    await search.fill("no such thing");
    await expect(page.getByRole("cell", { name: "No incidents match the selected filters." })).toBeVisible();
    await search.fill("");
    await expect(showing(page)).toHaveText(`Showing ${incidents.length} of ${incidents.length} incidents`);

    // the status filter and the count
    expect((await resolveCase(page, "inc-0001", "false_positive")).status()).toBe(200);
    await expect.poll(async () => (await row(page, "inc-0001").getByTestId("cell-status").innerText()).trim(), { timeout: 15_000 }).toBe("Resolved");
    await filterSelect(page, "Status").selectOption("resolved");
    expect(await rowIds(page)).toEqual(["inc-0001"]);
    await expect(showing(page)).toHaveText(`Showing 1 of ${incidents.length} incidents`);
    await filterSelect(page, "Status").selectOption("active");
    await expect(showing(page)).toHaveText(`Showing ${incidents.length - 1} of ${incidents.length} incidents`);
    await filterSelect(page, "Status").selectOption("all");
    await page.getByLabel(/severity/i).first().selectOption("critical"); // refetches with the filter
    await expect.poll(() => rowIds(page), { timeout: 15_000 }).toEqual(["inc-0004"]);
    expect(issues()).toEqual([]);
  });

  test("6. phone width: cards with the title, meta, AI tag, status, assignee and the analyst pill", async ({ page }) => {
    const issues = trackIssues(page);
    const incidents = await apiIncidents(page);
    const byId = new Map(incidents.map((i) => [i.incident_id, i]));
    expect((await resolveCase(page, "inc-0001", oppositeVerdict(byId.get("inc-0001")!.triage_verdict))).status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await openList(page);

    const cards = page.locator("[data-incident-id]:not(tr)");
    await expect(cards).toHaveCount(incidents.length);
    for (const inc of incidents) {
      const card = page.locator(`div[data-incident-id="${inc.incident_id}"]`);
      await expect(card.getByTestId("card-incident-title")).not.toBeEmpty();
      await expect(card.getByTestId("card-incident-meta")).toHaveText(incidentMeta(inc.host, inc.user, inc.alert_ids.length));
      if (inc.incident_id === "inc-0001") {
        // resolved: the analyst's pill leads and there is no AI pill
        await expect(card.locator('[data-source-tag="ai"]')).toHaveCount(0);
        await expect(card.getByTestId("analyst-verdict-pill").getByText("Analyst", { exact: true })).toBeVisible();
      } else {
        await expect(card.locator('[data-source-tag="ai"]').getByText("AI", { exact: true })).toBeVisible();
      }
      await expect(card.getByTestId("card-raised")).toHaveText(formatShortDateTime(inc.incident_raised_time));
      await expect(card.locator("[data-status]")).toHaveCount(1);
      await expect(card.getByTestId("card-assignee")).toHaveText("Unassigned");
    }
    const resolved = page.locator('div[data-incident-id="inc-0001"]');
    await expect(resolved.getByTestId("analyst-verdict-pill")).toBeVisible();
    await expect(resolved.getByTestId("disagreement-marker")).toHaveCount(1);
    await expect(page.locator('div[data-incident-id="inc-0002"]').getByTestId("analyst-verdict-pill")).toHaveCount(0);

    const o = await overflow(page);
    expect(o.doc).toBeLessThanOrEqual(0);
    expect(o.scroller).toBeLessThanOrEqual(0);
    expectUsable(await shot(page.locator("main"), "list-14a-390.png"));
    expect(issues()).toEqual([]);
  });

  test("7. alerts unavailable: the list still renders with fallback titles and no error banner", async ({ page }) => {
    const issues = trackIssues(page, [503]);
    await page.route("**/api/alerts*", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "backend_unavailable" }) }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    await page.waitForTimeout(1000);
    const incidents = await apiIncidents(page);
    expect((await rowIds(page)).length).toBe(incidents.length);
    // no rule titles: scenario incidents keep their scenario, the others fall back to the technique
    await expect(row(page, "inc-0003").getByTestId("cell-incident-title")).toHaveText("Credential dump chain");
    await expect(row(page, "inc-0001").getByTestId("cell-incident-title")).toHaveText("Technique T1012");
    await expect(row(page, "inc-0005").getByTestId("cell-incident-title")).toHaveText("Technique T1046");
    await expect(page.getByText("Could not reach the backend.")).toHaveCount(0);
    await expect(page.locator("p.text-red-600")).toHaveCount(0);

    // when alerts answer again the rule titles arrive without a reload
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.reload();
    await page.waitForSelector("tbody tr[data-incident-id]");
    await expect(row(page, "inc-0001").getByTestId("cell-incident-title")).not.toHaveText("Technique T1012", { timeout: 15_000 });
    expect(issues()).toEqual([]);
  });

  test("8. Overview: Newest incidents rows have the incident cell and the AI-tagged badge", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const incidents = await apiIncidents(page);
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const newest = page.getByText("Newest incidents", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(newest.locator("a[href^='/incidents/inc-']")).toHaveCount(Math.min(5, incidents.length), { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    const links = newest.locator("a[href^='/incidents/inc-']");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      const id = ((await link.getAttribute("href")) ?? "").replace("/incidents/", "");
      const inc = incidents.find((x) => x.incident_id === id)!;
      const title = (await link.getByTestId("newest-incident-title").innerText()).trim();
      expect(title.length, id).toBeGreaterThan(0);
      expect(title).not.toBe("-");
      await expect(link.getByTestId("newest-incident-meta")).toHaveText(incidentMeta(inc.host, inc.user, inc.alert_ids.length));
      await expect(link.locator('[data-source-tag="ai"]').getByText("AI", { exact: true })).toBeVisible();
      if (inc.matched_scenario === null) expect(title === "Incident" ? "bare" : "ok", id).toBe("ok");
    }
    expect(await page.getByTestId("overview-card").count()).toBe(13);
    const o = await page.evaluate(() => {
      const scroller = document.querySelector("div.h-screen.min-w-0.flex-1.overflow-y-auto");
      return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
    });
    expect(o).toBeLessThanOrEqual(0);

    // a tooltip on a right-aligned badge stays inside the card
    await links.first().locator('[data-source-tag="ai"]').hover();
    await expect(page.getByRole("tooltip")).toHaveText(AI_TOOLTIP);
    const tip = await page.getByRole("tooltip").boundingBox();
    const card = await newest.boundingBox();
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
    expect(issues()).toEqual([]);
  });

  test("9. incident page: the Analyst pill in the Case card and the note in the AI triage card", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const incidents = await apiIncidents(page);
    const byId = new Map(incidents.map((i) => [i.incident_id, i]));
    const opposite = oppositeVerdict(byId.get("inc-0001")!.triage_verdict);
    const same = sameVerdict(byId.get("inc-0005")!.triage_verdict);
    expect((await resolveCase(page, "inc-0001", opposite, "Checked with the owner.")).status()).toBe(200);
    expect((await resolveCase(page, "inc-0005", same)).status()).toBe(200);
    const label = (v: string) => ({ true_positive: "true positive", false_positive: "false positive" })[v];

    // disagreeing case
    await page.goto("/incidents/inc-0001");
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
    const pill = page.getByTestId("case-card").getByTestId("analyst-verdict-pill");
    await expect(pill).toBeVisible();
    await expect(pill.getByText("Analyst", { exact: true })).toBeVisible();
    await expect(pill.getByTestId("case-verdict")).toHaveText(opposite === "true_positive" ? "True positive" : "False positive");
    await expect(page.getByTestId("case-resolution-note")).toHaveText("Checked with the owner.");
    const note = page.getByTestId("triage-analyst-note");
    await expect(note).toBeVisible();
    await expect(note.getByTestId("triage-analyst-sentence")).toHaveText(`Analyst resolved this as ${label(opposite)}.`);
    await expect(note.getByTestId("triage-disagree-sentence")).toHaveText("The analyst's verdict differs from the AI's.");
    await expect(note.getByTestId("disagreement-marker")).toHaveCount(1);
    const insideTriageCard = await note.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node && !(node.className?.toString().includes("rounded") && node.textContent?.includes("AI triage"))) node = node.parentElement;
      return node !== null;
    });
    expect(insideTriageCard).toBe(true);

    // agreeing case: the note, no disagreement sentence
    await page.goto("/incidents/inc-0005");
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("triage-analyst-note")).toBeVisible();
    await expect(page.getByTestId("triage-analyst-sentence")).toHaveText(`Analyst resolved this as ${label(same)}.`);
    await expect(page.getByTestId("triage-disagree-sentence")).toHaveCount(0);
    await expect(page.getByTestId("disagreement-marker")).toHaveCount(0);

    // unresolved: no note and no pill
    await page.goto("/incidents/inc-0003");
    await expect(page.getByTestId("case-status")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("triage-analyst-note")).toHaveCount(0);
    await expect(page.getByTestId("analyst-verdict-pill")).toHaveCount(0);
    expect(issues()).toEqual([]);
  });

  test("11. screenshots", async ({ page }) => {
    const issues = trackIssues(page);
    const incidents = await apiIncidents(page);
    const byId = new Map(incidents.map((i) => [i.incident_id, i]));
    expect((await resolveCase(page, "inc-0001", oppositeVerdict(byId.get("inc-0001")!.triage_verdict), "Checked with the owner.")).status()).toBe(200);
    expect((await resolveCase(page, "inc-0005", sameVerdict(byId.get("inc-0005")!.triage_verdict))).status()).toBe(200);
    await page.route("**/api/cases", async (route) => {
      const res = await route.fetch();
      const list = (await res.json()) as Record<string, unknown>[];
      list.push({
        incident_id: "inc-0003", status: "resolved", assignee: "Analyst 2", verdict: "undetermined",
        updated_time: "2026-10-04T10:00:00.000Z", resolved_time: "2026-10-04T10:00:00.000Z", version: 2,
      });
      await route.fulfill({ response: res, json: list });
    });

    const sizes: { width: number; height: number }[] = [];
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openList(page, theme);
      sizes.push(await shot(page.locator("main"), `list-14a-${theme}-1440.png`));
    }
    await page.setViewportSize({ width: 1024, height: 800 });
    await openList(page, "light");
    sizes.push(await shot(page.locator("main"), "list-14a-light-1024.png"));

    // the sidebar, expanded and collapsed, light and dark
    for (const theme of ["light", "dark"] as const) {
      for (const collapsed of [false, true]) {
        await page.addInitScript(
          ({ t, c }) => {
            localStorage.setItem("theme", t);
            localStorage.setItem("sidebar-collapsed", String(c));
          },
          { t: theme, c: collapsed },
        );
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/");
        await expect(page.locator("aside")).toBeVisible();
        await expect(page.locator(`aside button[aria-label="${collapsed ? "Expand" : "Collapse"} sidebar"]`)).toBeVisible();
        sizes.push(await shot(page.locator("aside"), `sidebar-14a-${collapsed ? "collapsed" : "expanded"}-${theme}.png`));
      }
    }

    // the Case card and the AI triage card on the disagreeing incident
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/incidents/inc-0001");
    await expect(page.getByTestId("triage-analyst-note")).toBeVisible({ timeout: 15_000 });
    sizes.push(await shot(page.getByTestId("case-card"), "case-card-14a-resolved-light.png"));
    const triageCard = page.getByTestId("triage-analyst-note").locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    sizes.push(await shot(triageCard, "triage-card-14a-disagree-light.png"));

    // the Overview Newest incidents card
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const newest = page.getByText("Newest incidents", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(newest.locator("a[href^='/incidents/inc-']").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    sizes.push(await shot(newest, "overview-newest-14a-light-1440.png"));

    for (const size of sizes) expectUsable(size);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Realistic backend, read only

test.describe("incident list (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("10. eight rows, real titles, 52px rows, and the analyst pills match the library", async ({ page }) => {
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });
    const incidents = await apiIncidents(page);
    const cases = (await (await page.request.get("/api/cases")).json()) as { incident_id: string; status: string; verdict: string | null }[];
    const caseById = new Map(cases.map((c) => [c.incident_id, c]));
    expect(incidents.length).toBe(8);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    expect((await rowIds(page)).sort()).toEqual(incidents.map((i) => i.incident_id).sort());
    const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBe(52);

    for (const inc of incidents) {
      const r = row(page, inc.incident_id);
      const title = (await r.getByTestId("cell-incident-title").innerText()).trim();
      expect(title.length, inc.incident_id).toBeGreaterThan(0);
      expect(title, inc.incident_id).not.toBe("Incident");
      expect(title, inc.incident_id).not.toBe("-");

      const c = caseById.get(inc.incident_id);
      const resolved = c?.status === "resolved" && Boolean(c.verdict);
      const pill = r.getByTestId("analyst-verdict-pill");
      const marker = r.getByTestId("disagreement-marker");
      await expect(pill, inc.incident_id).toHaveCount(resolved ? 1 : 0);
      await expect(r.locator('[data-source-tag="ai"]'), inc.incident_id).toHaveCount(resolved ? 0 : 1);
      await expect(marker, inc.incident_id).toHaveCount(resolved && disagrees(inc.triage_verdict, c!.verdict) ? 1 : 0);
      if (resolved) {
        expect(sideOfAnalyst(c!.verdict) === null || ["malicious", "benign"].includes(sideOfAnalyst(c!.verdict)!)).toBe(true);
      }
    }

    await page.waitForTimeout(1500);
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
