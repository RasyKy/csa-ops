import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

import { humanizeScenario, incidentTitle } from "../lib/incidentDisplay";
import { describeResponseAction, describeResponseDetail, type ResponseTextInput } from "../lib/responseText";
import { describeResponseAction as legacyDescribe } from "../lib/responseWording";
import type { ResponseAction } from "../lib/types";

const REALISTIC = Boolean(process.env.E2E_REALISTIC);
const SHOTS = path.join(__dirname, "screenshots");

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

function action(over: Partial<ResponseTextInput> & { action: string }): ResponseTextInput {
  return { host: "WS01", mode: "dry_run", status: "issued", target: {}, ...over };
}

function dashboardKey(): string {
  if (process.env.DASHBOARD_API_KEY) return process.env.DASHBOARD_API_KEY;
  const file = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(file)) {
    const m = fs.readFileSync(file, "utf-8").match(/^DASHBOARD_API_KEY=(.*)$/m);
    if (m) return m[1].trim();
  }
  return "";
}

async function graphRuleTitles(page: Page, id: string): Promise<string[]> {
  const res = await page.request.get(`http://localhost:8000/incidents/${id}/graph`, {
    headers: { "X-API-Key": dashboardKey() },
  });
  expect(res.ok(), `graph API for ${id}`).toBe(true);
  const graph = (await res.json()) as { nodes: { is_trigger: boolean; rule_title: string | null }[] };
  return graph.nodes.filter((n) => n.is_trigger && n.rule_title).map((n) => n.rule_title as string);
}

function cardByHeading(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
}

function newestCard(page: Page) {
  return page.getByText("Newest incidents", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
}

test.describe("responseText: unit", () => {
  test("PID counts 1, 2, 3 and 5", () => {
    const k = (pids: number[]) => action({ action: "kill_process", target: { pids } });
    expect(describeResponseAction(k([3468]))).toBe("Would have stopped process 3468 (practice mode)");
    expect(describeResponseAction(k([3468, 3812]))).toBe("Would have stopped process 3468, 3812 (practice mode)");
    expect(describeResponseDetail(k([3468, 3812]))).toBeNull();
    expect(describeResponseAction(k([1, 2, 3]))).toBe("Would have stopped 3 processes (practice mode)");
    expect(describeResponseDetail(k([1, 2, 3]))).toBe("PIDs 1, 2, 3");
    expect(describeResponseAction(k([3468, 3812, 4076, 4116, 4172]))).toBe(
      "Would have stopped 5 processes (practice mode)",
    );
    expect(describeResponseDetail(k([3468, 3812, 4076, 4116, 4172]))).toBe("PIDs 3468, 3812, 4076, 4116, 4172");
  });

  test("address counts 1 and 3", () => {
    const b = (ips: string[]) => action({ action: "block_address", target: { remote_ips: ips } });
    expect(describeResponseAction(b(["203.0.113.50"]))).toBe("Would have blocked address 203.0.113.50 (practice mode)");
    expect(describeResponseDetail(b(["203.0.113.50"]))).toBeNull();
    const three = ["203.0.113.50", "198.51.100.7", "192.0.2.9"];
    expect(describeResponseAction(b(three))).toBe("Would have blocked 3 addresses (practice mode)");
    expect(describeResponseDetail(b(three))).toBe("Addresses 203.0.113.50, 198.51.100.7, 192.0.2.9");
  });

  test("many targets also read correctly outside practice mode", () => {
    const pids = [1, 2, 3, 4];
    const t = { pids };
    expect(describeResponseAction(action({ action: "kill_process", mode: "live", status: "executed", target: t }))).toBe(
      "Stopped 4 processes",
    );
    expect(describeResponseAction(action({ action: "kill_process", mode: "live", status: "failed", target: t }))).toBe(
      "Failed to stop 4 processes",
    );
    expect(describeResponseAction(action({ action: "kill_process", mode: "live", status: "issued", target: t }))).toBe(
      "Stopping 4 processes…",
    );
    expect(
      describeResponseAction(action({ action: "kill_process", status: "blocked_by_kill_switch", target: t })),
    ).toBe("Blocked by kill switch -- 4 processes were not touched");
  });

  test("existing wording is unchanged for every action, mode and status", () => {
    const targets: Record<string, Record<string, unknown>> = {
      log: {},
      alert: {},
      kill_process: { pids: [4412] },
      block_address: { remote_ips: ["203.0.113.7", "198.51.100.1"] },
      quarantine_file: { file_paths: ["C:\\Users\\a\\x.exe", "C:\\Users\\a\\y.exe", "C:\\Users\\a\\z.exe"] },
      isolate_host: {},
      unblock_address: { remote_ips: ["203.0.113.7"] },
      restore_file: { file_paths: ["C:\\Users\\a\\x.exe"] },
      unisolate_host: {},
      something_new: { pids: [1] },
    };
    let compared = 0;
    for (const [name, target] of Object.entries(targets)) {
      for (const mode of ["dry_run", "live"] as const) {
        for (const status of ["issued", "received", "executed", "failed", "blocked_by_kill_switch"]) {
          const a = action({ action: name, mode, status, target });
          const legacy = legacyDescribe({ ...a, action_id: "x", incident_id: "i" } as unknown as ResponseAction);
          expect(describeResponseAction(a), `${name} ${mode} ${status}`).toBe(legacy);
          expect(describeResponseDetail(a)).toBeNull();
          compared += 1;
        }
      }
    }
    expect(compared).toBe(100);
  });

  test("empty or missing target falls back to the bare verb", () => {
    expect(describeResponseAction(action({ action: "kill_process", target: {} }))).toBe(
      "Would have stopped (practice mode)",
    );
    expect(describeResponseAction(action({ action: "kill_process", target: undefined as never }))).toBe(
      "Would have stopped (practice mode)",
    );
  });
});

test.describe("incidentTitle: unit", () => {
  const nodes = [
    { rule_title: "Late hit", is_trigger: true, timestamp: "2026-10-04T10:00:09.000Z" },
    { rule_title: "Early hit", is_trigger: true, timestamp: "2026-10-04T10:00:02.000Z" },
    { rule_title: "Not a trigger", is_trigger: false, timestamp: "2026-10-04T10:00:01.000Z" },
    { rule_title: null, is_trigger: true, timestamp: "2026-10-04T10:00:00.000Z" },
  ];

  test("null scenario uses the earliest trigger rule title", () => {
    expect(incidentTitle({ matched_scenario: null, host: "WS03" }, nodes)).toBe("Early hit on WS03");
  });

  test("null scenario without a usable trigger keeps the old title", () => {
    expect(incidentTitle({ matched_scenario: null, host: "WS03" })).toBe("Incident on WS03");
    expect(incidentTitle({ matched_scenario: null, host: "WS03" }, [])).toBe("Incident on WS03");
    expect(incidentTitle({ matched_scenario: null, host: "WS03" }, [nodes[2], nodes[3]])).toBe("Incident on WS03");
  });

  test("a scenario is unchanged whatever the nodes say", () => {
    const inc = { matched_scenario: "credential_dump_chain", host: "WS01" };
    expect(incidentTitle(inc)).toBe("Credential dump chain on WS01");
    expect(incidentTitle(inc, nodes)).toBe("Credential dump chain on WS01");
  });

  test("nodes without timestamps keep input order, timestamps win over missing ones", () => {
    const bare = [
      { rule_title: "First", is_trigger: true },
      { rule_title: "Second", is_trigger: true },
    ];
    expect(incidentTitle({ host: "H" }, bare)).toBe("First on H");
    const mixed = [
      { rule_title: "Untimed", is_trigger: true },
      { rule_title: "Timed", is_trigger: true, timestamp: "2026-10-04T10:00:00.000Z" },
    ];
    expect(incidentTitle({ host: "H" }, mixed)).toBe("Timed on H");
    expect(incidentTitle({ matched_scenario: null, host: null }, nodes)).toBe("Early hit");
  });

  test("humanizeScenario still reads as before", () => {
    expect(humanizeScenario("credential_dump_chain")).toBe("Credential dump chain");
  });
});

test.describe("display polish: default backend", () => {
  test.skip(REALISTIC, "default-backend assertions; run without E2E_REALISTIC");

  test("Overview Newest incidents shows humanized scenarios", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const card = newestCard(page);
    await expect(card.getByText("Credential dump chain", { exact: true })).toBeVisible({ timeout: 15_000 });
    const text = await card.innerText();
    expect(text).not.toContain("_");
    const cell = card.getByText("Credential dump chain", { exact: true });
    await expect(cell).toHaveAttribute("title", "Credential dump chain");
    expect(issues).toEqual([]);
  });

  test("/incidents shows humanized scenarios and search keeps working", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents");
    const table = page.locator("table");
    await expect(table.getByText("Credential dump chain", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await table.locator("tbody").innerText()).not.toContain("_chain");
    await expect(table.getByText("Credential dump chain", { exact: true })).toHaveAttribute(
      "title",
      "Credential dump chain",
    );

    const search = page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first();
    const row3 = table.locator("tbody tr").filter({ hasText: "WS01" });

    await search.fill("credential");
    await expect(page.getByText(/Showing \d+ of \d+ incidents/)).toContainText("Showing 1 of");
    await expect(row3).toHaveCount(1);
    await expect(table.getByText("Credential dump chain", { exact: true })).toBeVisible();

    await search.fill("credential_dump");
    await expect(page.getByText(/Showing \d+ of \d+ incidents/)).toContainText("Showing 1 of");

    await search.fill("dump chain");
    await expect(page.getByText(/Showing \d+ of \d+ incidents/)).toContainText("Showing 1 of");
    expect(issues).toEqual([]);
  });

  test("inc-0001 header is '<rule title> on WS03'", async ({ page }) => {
    const issues = trackIssues(page);
    const titles = await graphRuleTitles(page, "inc-0001");
    expect(titles.length).toBeGreaterThan(0);
    await page.goto("/incidents/inc-0001");
    await expect(page.locator("h1")).toBeVisible({ timeout: 15_000 });
    const h1 = await page.locator("h1").innerText();
    expect(h1).toMatch(/ on WS03$/);
    expect(titles).toContain(h1.replace(/ on WS03$/, ""));
    expect(h1).not.toBe("Incident on WS03");
    expect(issues).toEqual([]);
  });

  test("heatmap cells wrap to at most 3 lines and keep the full label in title", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const card = cardByHeading(page, "MITRE ATT&CK coverage");
    const cells = card.getByTestId("mitre-cell");
    await expect(cells.first()).toBeVisible({ timeout: 15_000 });

    const results = await cells.evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLElement;
        const cs = getComputedStyle(e);
        const lh = parseFloat(cs.lineHeight);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        // natural height with the clamp removed
        const probe = e.cloneNode(true) as HTMLElement;
        probe.style.cssText = `position:absolute;visibility:hidden;width:${e.getBoundingClientRect().width}px;display:block;-webkit-line-clamp:unset;overflow:visible`;
        e.parentElement!.appendChild(probe);
        const natural = probe.getBoundingClientRect().height;
        probe.remove();
        return {
          title: e.getAttribute("title") ?? "",
          text: e.textContent ?? "",
          lh,
          pad,
          shown: e.getBoundingClientRect().height,
          naturalLines: Math.round((natural - pad) / lh),
          shownLines: Math.round((e.getBoundingClientRect().height - pad) / lh),
          clamp: cs.getPropertyValue("-webkit-line-clamp"),
        };
      }),
    );
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.clamp).toBe("3");
      expect(r.shownLines).toBeLessThanOrEqual(3);
      expect(r.shownLines).toBe(Math.min(r.naturalLines, 3));
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.title).toBe(r.text);
    }
    const longest = results.reduce((a, b) => (b.title.length > a.title.length ? b : a));
    console.log(`longest cell: "${longest.title}" natural=${longest.naturalLines} shown=${longest.shownLines}`);
    expect(issues).toEqual([]);
  });

  test("a heatmap label longer than 3 lines is cut at 3 (narrow column)", async ({ page }) => {
    await page.route("**/api/metrics/mitre*", (route) =>
      route.fulfill({
        json: {
          range: "all",
          since: null,
          as_of: new Date().toISOString(),
          coverage_status: "ok",
          techniques: {
            status: "ok",
            value: [{ technique: "T1048", tactic: "exfiltration", count: 3, status: "fired" }],
          },
        },
      }),
    );
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const cell = cardByHeading(page, "MITRE ATT&CK coverage").getByTestId("mitre-cell").first();
    await expect(cell).toBeVisible({ timeout: 15_000 });
    // squeeze the cell so the label needs more than 3 lines
    const info = await cell.evaluate((el) => {
      const e = el as HTMLElement;
      e.style.width = "70px";
      const cs = getComputedStyle(e);
      const lh = parseFloat(cs.lineHeight);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return { lines: Math.round((e.getBoundingClientRect().height - pad) / lh), scroll: e.scrollHeight, client: e.clientHeight, lh, pad };
    });
    expect(info.lines).toBe(3);
    expect(info.scroll).toBeGreaterThan(info.client);
    await expect(cell).toHaveAttribute("title", /Exfiltration Over Alternative Protocol/);
  });
});

test.describe("display polish: realistic backend", () => {
  test.skip(!REALISTIC, "needs the realistic backend (E2E_REALISTIC=1)");

  test("inc-1006 response history summarizes five PIDs and lists them", async ({ page }) => {
    const issues = trackIssues(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-1006");
    const card = cardByHeading(page, "Response history");
    await expect(card.getByText("Would have stopped 5 processes (practice mode)", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const detail = card.getByTestId("response-detail");
    await expect(detail).toHaveCount(1);
    await expect(detail).toHaveText("PIDs 3468, 3812, 4076, 4116, 4172");
    const style = await detail.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { family: cs.fontFamily, size: cs.fontSize, wrap: cs.overflowWrap, ws: cs.whiteSpace };
    });
    expect(style.family).toMatch(/mono/i);
    expect(style.size).toBe("12px");
    expect(style.ws).not.toBe("nowrap");
    expect(issues).toEqual([]);
  });

  test("inc-1001 header is '<rule title> on WS06'", async ({ page }) => {
    const issues = trackIssues(page);
    const titles = await graphRuleTitles(page, "inc-1001");
    expect(titles.length).toBeGreaterThan(0);
    await page.goto("/incidents/inc-1001");
    await expect(page.locator("h1")).toBeVisible({ timeout: 15_000 });
    const h1 = await page.locator("h1").innerText();
    expect(h1).toMatch(/ on WS06$/);
    expect(titles).toContain(h1.replace(/ on WS06$/, ""));
    expect(issues).toEqual([]);
  });
});

test.describe("display polish: screenshots", () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  function check(file: string) {
    const { width, height } = getPngDimensions(file);
    console.log(`${path.basename(file)} ${width}x${height}`);
    expect(width).toBeGreaterThan(250);
    expect(height).toBeGreaterThan(40);
  }

  test("overview newest incidents card (light)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const card = newestCard(page);
    await expect(card.getByRole("link").nth(1)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const file = path.join(SHOTS, REALISTIC ? "polish-9b-overview-newest-realistic-light.png" : "polish-9b-overview-newest-light.png");
    await card.screenshot({ path: file });
    check(file);
  });

  test("response history card and incident header (light)", async ({ page }) => {
    test.skip(!REALISTIC, "uses inc-1006 and inc-1001 from the realistic set");
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/incidents/inc-1006");
    const history = cardByHeading(page, "Response history");
    await expect(history.getByTestId("response-detail")).toBeVisible({ timeout: 15_000 });
    const f1 = path.join(SHOTS, "polish-9b-inc-1006-response-history-light.png");
    await history.screenshot({ path: f1 });
    check(f1);

    await page.goto("/incidents/inc-1001");
    const h1 = page.locator("h1");
    await expect(h1).toBeVisible({ timeout: 15_000 });
    const f2 = path.join(SHOTS, "polish-9b-inc-1001-header-light.png");
    const box = await page.locator("main").boundingBox();
    const bar = await page.locator(".border-b.border-line").first().boundingBox();
    const top = box!.y;
    const bottom = bar!.y + bar!.height;
    await page.screenshot({ path: f2, clip: { x: box!.x, y: Math.max(0, top), width: box!.width, height: bottom - top } });
    check(f2);
  });
});
