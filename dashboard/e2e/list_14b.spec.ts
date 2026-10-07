import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { disagrees, sideOfAi, verdictRelation } from "../lib/caseJoin";
import { E2E_DATA_ROOT } from "../playwright.config";

// Step 14b: in the incidents list a resolved incident leads with the analyst's
// verdict, and the AI's verdict shows only when it adds something.

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
// Pure tests: verdictRelation

// The expected relation, written out from the rules rather than from the code under test.
const AI_SIDE: Record<string, "malicious" | "benign" | "uncertain"> = {
  true_positive: "malicious",
  likely_true_positive: "malicious",
  false_positive: "benign",
  likely_false_positive: "benign",
  needs_review: "uncertain",
};
const ANALYST_SIDE: Record<string, "malicious" | "benign"> = {
  true_positive: "malicious",
  false_positive: "benign",
  benign_activity: "benign",
};

function expectedRelation(ai: unknown, analyst: unknown): string {
  const aiSide = typeof ai === "string" ? AI_SIDE[ai] : undefined;
  if (aiSide === undefined) return "no_ai";
  const analystSide = typeof analyst === "string" ? ANALYST_SIDE[analyst] : undefined;
  if (analystSide === undefined) return "analyst_undetermined";
  if (aiSide === "uncertain") return "ai_uncertain";
  return aiSide === analystSide ? "agree" : "disagree";
}

const AI_VALUES: unknown[] = [
  "true_positive",
  "likely_true_positive",
  "false_positive",
  "likely_false_positive",
  "needs_review",
  null,
  undefined,
  "mystery",
];
const ANALYST_VALUES: unknown[] = ["true_positive", "false_positive", "benign_activity", "undetermined", null, "mystery"];

test.describe("verdictRelation: unit", () => {
  test("every AI verdict by every analyst verdict matches the precedence", () => {
    for (const ai of AI_VALUES) {
      for (const analyst of ANALYST_VALUES) {
        expect(verdictRelation(ai, analyst), `${String(ai)} vs ${String(analyst)}`).toBe(expectedRelation(ai, analyst));
      }
    }
  });

  test("disagrees() is true exactly when the relation is disagree", () => {
    for (const ai of AI_VALUES) {
      for (const analyst of ANALYST_VALUES) {
        expect(disagrees(ai, analyst), `${String(ai)} vs ${String(analyst)}`).toBe(verdictRelation(ai, analyst) === "disagree");
      }
    }
    // odd inputs of other types never throw and have no AI side
    for (const odd of ["", 5, {}, [], true]) {
      expect(verdictRelation(odd, "true_positive"), String(odd)).toBe("no_ai");
      expect(disagrees(odd, "true_positive"), String(odd)).toBe(false);
      expect(verdictRelation("true_positive", odd), String(odd)).toBe("analyst_undetermined");
    }
  });

  test("spot checks written out", () => {
    expect(verdictRelation("true_positive", "true_positive")).toBe("agree");
    expect(verdictRelation("likely_true_positive", "true_positive")).toBe("agree");
    expect(verdictRelation("likely_false_positive", "benign_activity")).toBe("agree");
    expect(verdictRelation("likely_true_positive", "false_positive")).toBe("disagree");
    expect(verdictRelation("false_positive", "true_positive")).toBe("disagree");
    expect(verdictRelation("needs_review", "true_positive")).toBe("ai_uncertain");
    expect(verdictRelation("needs_review", "undetermined")).toBe("analyst_undetermined");
    // no AI side wins over everything else, even an undetermined analyst
    expect(verdictRelation(null, "undetermined")).toBe("no_ai");
    expect(verdictRelation("mystery", "true_positive")).toBe("no_ai");
    expect(verdictRelation(undefined, null)).toBe("no_ai");
    // an undetermined analyst wins over an uncertain AI
    expect(verdictRelation("needs_review", "mystery")).toBe("analyst_undetermined");
    expect(sideOfAi("needs_review")).toBe("uncertain");
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
  alert_ids: string[];
  incident_raised_time: string;
  triage_verdict: string | null;
  triage_status: string | null;
}

interface ApiCase {
  incident_id: string;
  status: string;
  verdict: string | null;
}

// The pill labels, written out so a wrong label in the page cannot hide behind itself.
const AI_LABEL: Record<string, string> = {
  true_positive: "True positive",
  likely_true_positive: "Likely true positive",
  false_positive: "False positive",
  likely_false_positive: "Likely false positive",
  needs_review: "Needs review",
};
const ANALYST_LABEL: Record<string, string> = {
  true_positive: "True positive",
  false_positive: "False positive",
  benign_activity: "Benign activity",
  undetermined: "Undetermined",
};

const aiSaidText = (aiVerdict: string) => `AI said ${AI_LABEL[aiVerdict].toLowerCase()}`;

function trackIssues(page: Page): () => string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
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
const resolveCase = (page: Page, id: string, verdict: string) =>
  page.request.post(`${caseUrl(id)}/resolve`, { data: { verdict }, headers: { "x-actor": "Tester" } });

async function apiIncidents(page: Page): Promise<ApiIncident[]> {
  const res = await page.request.get("/api/incidents?limit=500");
  expect(res.ok()).toBe(true);
  return (await res.json()) as ApiIncident[];
}

// The analyst verdict on the OPPOSITE side of the AI's call, and one on the SAME side,
// derived from the API data.
function opposite(aiVerdict: string | null): string {
  const side = sideOfAi(aiVerdict);
  expect(["malicious", "benign"], `AI verdict ${aiVerdict} must have a side`).toContain(side);
  return side === "malicious" ? "false_positive" : "true_positive";
}
function same(aiVerdict: string | null): string {
  const side = sideOfAi(aiVerdict);
  expect(["malicious", "benign"], `AI verdict ${aiVerdict} must have a side`).toContain(side);
  return side === "malicious" ? "true_positive" : "false_positive";
}

const row = (page: Page, id: string) => page.locator(`tbody tr[data-incident-id="${id}"]`);
const card = (page: Page, id: string) => page.locator(`div[data-incident-id="${id}"]`);
const rows = (page: Page) => page.locator("tbody tr[data-incident-id]");

async function openList(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto("/incidents");
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

// The undetermined case rides in on the case list: real writes only go to inc-0001 and inc-0005.
async function mockUndeterminedCase(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/cases",
    async (route) => {
      const res = await route.fetch();
      const list = (await res.json()) as Record<string, unknown>[];
      list.push({
        incident_id: "inc-0003", status: "resolved", assignee: null, verdict: "undetermined",
        updated_time: "2026-10-04T10:00:00.000Z", resolved_time: "2026-10-04T10:00:00.000Z", version: 2,
      });
      await route.fulfill({ response: res, json: list });
    },
  );
}

interface Setup {
  aiOf: Map<string, string>; // incident id -> the AI verdict from the API
  disagreeVerdict: string; // the analyst verdict written on inc-0001
  agreeVerdict: string; // the analyst verdict written on inc-0005
}

// inc-0001 is resolved on the opposite side of its AI verdict, inc-0005 on the same side,
// and inc-0003 as undetermined (mocked). inc-0002 and inc-0004 stay unresolved.
async function setupState(page: Page): Promise<Setup> {
  const incidents = await apiIncidents(page);
  const aiOf = new Map<string, string>();
  for (const inc of incidents) if (inc.triage_verdict) aiOf.set(inc.incident_id, inc.triage_verdict);
  for (const id of ["inc-0001", "inc-0003", "inc-0005"]) {
    expect(aiOf.get(id), `${id} needs an AI verdict in the fixtures`).toBeTruthy();
  }
  const disagreeVerdict = opposite(aiOf.get("inc-0001")!);
  const agreeVerdict = same(aiOf.get("inc-0005")!);
  expect((await resolveCase(page, "inc-0001", disagreeVerdict)).status()).toBe(200);
  expect((await resolveCase(page, "inc-0005", agreeVerdict)).status()).toBe(200);
  await mockUndeterminedCase(page);
  return { aiOf, disagreeVerdict, agreeVerdict };
}

// ---------------------------------------------------------------------------
// Default backend, temp DATA_ROOT

test.describe("incident list, analyst first (default backend, temp DATA_ROOT)", () => {
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

  for (const theme of ["light", "dark"] as const) {
    test(`table (${theme}): agree, disagree, undetermined and unresolved rows`, async ({ page }) => {
      const issues = trackIssues(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      const s = await setupState(page);
      await openList(page, theme);
      expectUsable(await shot(page.locator("main"), `list-14b-${theme}-1440.png`));

      // agree (inc-0005): the analyst pill alone
      const agree = row(page, "inc-0005");
      const agreePill = agree.getByTestId("analyst-verdict-pill");
      await expect(agreePill).toBeVisible();
      await expect(agreePill.getByText("Analyst", { exact: true })).toBeVisible();
      await expect(agreePill).toContainText(ANALYST_LABEL[s.agreeVerdict]);
      await expect(agree.locator('[data-source-tag="ai"]')).toHaveCount(0);
      await expect(agree.getByTestId("triage-ai-said")).toHaveCount(0);
      await expect(agree.getByTestId("disagreement-marker")).toHaveCount(0);
      await expect(agreePill).toHaveAttribute("title", `Analyst verdict: ${ANALYST_LABEL[s.agreeVerdict]}. The AI reached the same conclusion.`);
      await agreePill.hover();
      await expect(page.getByRole("tooltip")).toContainText("same conclusion");
      await expect(page.getByRole("tooltip")).toHaveText("Analyst verdict. The AI reached the same conclusion.");
      await page.mouse.move(5, 5);
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      // disagree (inc-0001): the pill, the marker and "AI said <label>"
      const disagree = row(page, "inc-0001");
      const disagreePill = disagree.getByTestId("analyst-verdict-pill");
      const aiLabel1 = aiSaidText(s.aiOf.get("inc-0001")!);
      await expect(disagreePill).toBeVisible();
      await expect(disagreePill).toContainText(ANALYST_LABEL[s.disagreeVerdict]);
      await expect(disagree.locator('[data-source-tag="ai"]')).toHaveCount(0);
      await expect(disagree.getByTestId("disagreement-marker")).toHaveCount(1);
      await expect(disagree.getByTestId("triage-ai-said")).toHaveText(aiLabel1);
      await expect(disagree.getByTestId("triage-ai-said").locator("[title]")).toHaveAttribute("title", aiLabel1);
      await disagree.getByTestId("disagreement-marker").hover();
      await expect(page.getByRole("tooltip")).toHaveText("Analyst disagrees with the AI");
      await expect(disagree.getByTestId("disagreement-marker")).toHaveAttribute("aria-label", "Analyst disagrees with the AI");
      await page.mouse.move(5, 5);
      await disagreePill.hover();
      await expect(page.getByRole("tooltip")).toHaveText(`Analyst verdict. The AI said ${AI_LABEL[s.aiOf.get("inc-0001")!].toLowerCase()}.`);
      await page.mouse.move(5, 5);

      // the second line sits under the pill, inside the 52px row
      const rowBox = (await disagree.boundingBox())!;
      const pillBox = (await disagreePill.boundingBox())!;
      const saidBox = (await disagree.getByTestId("triage-ai-said").boundingBox())!;
      expect(saidBox.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height - 1);
      expect(saidBox.y + saidBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5);

      // undetermined (inc-0003): the pill says so, the AI's verdict is shown, no marker
      const undetermined = row(page, "inc-0003");
      await expect(undetermined.getByTestId("analyst-verdict-pill")).toContainText("Undetermined");
      await expect(undetermined.locator('[data-source-tag="ai"]')).toHaveCount(0);
      await expect(undetermined.getByTestId("triage-ai-said")).toHaveText(aiSaidText(s.aiOf.get("inc-0003")!));
      await expect(undetermined.getByTestId("disagreement-marker")).toHaveCount(0);
      await undetermined.getByTestId("analyst-verdict-pill").hover();
      await expect(page.getByRole("tooltip")).toHaveText(`Analyst verdict. The AI said ${AI_LABEL[s.aiOf.get("inc-0003")!].toLowerCase()}.`);
      await page.mouse.move(5, 5);

      // unresolved rows: the AI pill with its tag and nothing else
      for (const id of ["inc-0002", "inc-0004"]) {
        const r = row(page, id);
        await expect(r.locator('[data-source-tag="ai"]'), id).toBeVisible();
        await expect(r.locator('[data-source-tag="ai"]').getByText("AI", { exact: true }), id).toBeVisible();
        await expect(r.getByTestId("analyst-verdict-pill"), id).toHaveCount(0);
        await expect(r.getByTestId("triage-ai-said"), id).toHaveCount(0);
        await expect(r.getByTestId("disagreement-marker"), id).toHaveCount(0);
      }

      // the old analyst "line" is gone from the list
      await expect(page.locator('tbody [data-testid="analyst-verdict-line"]')).toHaveCount(0);

      // every row is 52px; no sideways scroll
      for (const [width, height] of [
        [1440, 900],
        [1024, 800],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        expect(heights.length).toBeGreaterThan(0);
        for (const h of heights) expect(h, `row height at ${width}px`).toBe(52);
        const o = await overflow(page);
        expect(o.doc, `${width}px document`).toBeLessThanOrEqual(0);
        expect(o.scroller, `${width}px scroller`).toBeLessThanOrEqual(0);
        expect(o.table, `${width}px table container`).toBeLessThanOrEqual(0);
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      expect(issues()).toEqual([]);
    });
  }

  test("phone width (390): the cards show the same content", async ({ page }) => {
    const issues = trackIssues(page);
    // tall enough that the screenshot of the scrolling area holds every card
    await page.setViewportSize({ width: 390, height: 1500 });
    const s = await setupState(page);
    await openList(page, "light");
    expectUsable(await shot(page.locator("main"), "list-14b-light-390.png"));

    const agree = card(page, "inc-0005");
    await expect(agree.getByTestId("analyst-verdict-pill")).toContainText(ANALYST_LABEL[s.agreeVerdict]);
    await expect(agree.getByTestId("analyst-verdict-pill").getByText("Analyst", { exact: true })).toBeVisible();
    await expect(agree.locator('[data-source-tag="ai"]')).toHaveCount(0);
    await expect(agree.getByTestId("triage-ai-said")).toHaveCount(0);
    await expect(agree.getByTestId("disagreement-marker")).toHaveCount(0);

    const disagree = card(page, "inc-0001");
    await expect(disagree.getByTestId("analyst-verdict-pill")).toContainText(ANALYST_LABEL[s.disagreeVerdict]);
    await expect(disagree.locator('[data-source-tag="ai"]')).toHaveCount(0);
    await expect(disagree.getByTestId("disagreement-marker")).toHaveCount(1);
    await expect(disagree.getByTestId("triage-ai-said")).toHaveText(aiSaidText(s.aiOf.get("inc-0001")!));

    const undetermined = card(page, "inc-0003");
    await expect(undetermined.getByTestId("analyst-verdict-pill")).toContainText("Undetermined");
    await expect(undetermined.getByTestId("triage-ai-said")).toHaveText(aiSaidText(s.aiOf.get("inc-0003")!));
    await expect(undetermined.getByTestId("disagreement-marker")).toHaveCount(0);

    for (const id of ["inc-0002", "inc-0004"]) {
      const c = card(page, id);
      await expect(c.locator('[data-source-tag="ai"]').getByText("AI", { exact: true }), id).toBeVisible();
      await expect(c.getByTestId("analyst-verdict-pill"), id).toHaveCount(0);
      await expect(c.getByTestId("triage-ai-said"), id).toHaveCount(0);
    }
    await expect(page.locator('div[data-incident-id] [data-testid="analyst-verdict-line"]')).toHaveCount(0);

    const o = await overflow(page);
    expect(o.doc).toBeLessThanOrEqual(0);
    expect(o.scroller).toBeLessThanOrEqual(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });

  test("an uncertain AI, a failed triage and a missing AI verdict (mocked, nothing written)", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    // inc-0002: the AI was unsure; inc-0004: triage failed but left a verdict behind; inc-0003: no AI verdict yet
    await page.route(
      (url) => url.pathname === "/api/incidents",
      async (route) => {
        const res = await route.fetch();
        const list = (await res.json()) as ApiIncident[];
        for (const inc of list) {
          if (inc.incident_id === "inc-0002") inc.triage_verdict = "needs_review";
          if (inc.incident_id === "inc-0004") {
            inc.triage_verdict = "true_positive";
            inc.triage_status = "failed";
          }
          if (inc.incident_id === "inc-0003") {
            inc.triage_verdict = null;
            inc.triage_status = null;
          }
        }
        await route.fulfill({ response: res, json: list });
      },
    );
    await page.route(
      (url) => url.pathname === "/api/cases",
      async (route) => {
        const res = await route.fetch();
        const list = (await res.json()) as Record<string, unknown>[];
        for (const [id, verdict] of [
          ["inc-0002", "true_positive"],
          ["inc-0003", "false_positive"],
          ["inc-0004", "false_positive"],
        ]) {
          list.push({
            incident_id: id, status: "resolved", assignee: null, verdict,
            updated_time: "2026-10-04T10:00:00.000Z", resolved_time: "2026-10-04T10:00:00.000Z", version: 2,
          });
        }
        await route.fulfill({ response: res, json: list });
      },
    );
    await openList(page, "light");

    // uncertain AI: "AI said needs review", no marker
    const uncertain = row(page, "inc-0002");
    await expect(uncertain.getByTestId("analyst-verdict-pill")).toContainText("True positive");
    await expect(uncertain.getByTestId("triage-ai-said")).toHaveText("AI said needs review");
    await expect(uncertain.getByTestId("disagreement-marker")).toHaveCount(0);
    await uncertain.getByTestId("analyst-verdict-pill").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Analyst verdict. The AI said needs review.");
    await page.mouse.move(5, 5);

    // failed triage and no AI verdict: the pill alone, with the plain tooltip
    for (const id of ["inc-0004", "inc-0003"]) {
      const r = row(page, id);
      await expect(r.getByTestId("analyst-verdict-pill"), id).toContainText("False positive");
      await expect(r.getByTestId("triage-ai-said"), id).toHaveCount(0);
      await expect(r.getByTestId("disagreement-marker"), id).toHaveCount(0);
      await expect(r.locator('[data-source-tag="ai"]'), id).toHaveCount(0);
      await r.getByTestId("analyst-verdict-pill").hover();
      await expect(page.getByRole("tooltip"), id).toHaveText("Analyst verdict.");
      await page.mouse.move(5, 5);
      await expect(r.getByTestId("analyst-verdict-pill"), id).toHaveAttribute("aria-label", "Analyst verdict: False positive.");
    }

    const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBe(52);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(issues()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Realistic backend, read only

test.describe("incident list, analyst first (realistic backend, read-only)", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("every row matches what verdictRelation says for the real cases", async ({ page }) => {
    const issues = trackIssues(page);
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${r.url()}`);
    });
    const incidents = await apiIncidents(page);
    const cases = (await (await page.request.get("/api/cases")).json()) as ApiCase[];
    const caseById = new Map(cases.map((c) => [c.incident_id, c]));
    expect(incidents.length).toBe(8);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openList(page);
    const heights = await rows(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBe(incidents.length);
    for (const h of heights) expect(h).toBe(52);

    let resolvedRows = 0;
    for (const inc of incidents) {
      const r = row(page, inc.incident_id);
      const c = caseById.get(inc.incident_id);
      const resolved = c?.status === "resolved" && Boolean(c.verdict);
      const ai = inc.triage_status === "failed" ? null : inc.triage_verdict;

      if (!resolved) {
        await expect(r.locator('[data-source-tag="ai"]'), inc.incident_id).toHaveCount(1);
        await expect(r.getByTestId("analyst-verdict-pill"), inc.incident_id).toHaveCount(0);
        await expect(r.getByTestId("triage-ai-said"), inc.incident_id).toHaveCount(0);
        await expect(r.getByTestId("disagreement-marker"), inc.incident_id).toHaveCount(0);
        continue;
      }
      resolvedRows++;
      const relation = verdictRelation(ai, c!.verdict);
      await expect(r.locator('[data-source-tag="ai"]'), inc.incident_id).toHaveCount(0);
      const pill = r.getByTestId("analyst-verdict-pill");
      await expect(pill, inc.incident_id).toHaveCount(1);
      await expect(pill, inc.incident_id).toContainText(ANALYST_LABEL[c!.verdict!] ?? c!.verdict!);
      await expect(r.getByTestId("disagreement-marker"), inc.incident_id).toHaveCount(relation === "disagree" ? 1 : 0);
      const said = r.getByTestId("triage-ai-said");
      if (relation === "disagree" || relation === "ai_uncertain" || relation === "analyst_undetermined") {
        await expect(said, inc.incident_id).toHaveText(aiSaidText(ai!));
      } else {
        await expect(said, inc.incident_id).toHaveCount(0);
      }
      const expectedTooltip =
        relation === "agree"
          ? "Analyst verdict. The AI reached the same conclusion."
          : relation === "no_ai"
            ? "Analyst verdict."
            : `Analyst verdict. The AI said ${AI_LABEL[ai!].toLowerCase()}.`;
      await pill.hover();
      await expect(page.getByRole("tooltip"), inc.incident_id).toHaveText(expectedTooltip);
      await page.mouse.move(5, 5);
    }
    console.log(`realistic rows: ${incidents.length}, resolved with a verdict: ${resolvedRows}`);

    await page.waitForTimeout(1500);
    expect(mutations).toEqual([]);
    expect(issues()).toEqual([]);
  });
});
