import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

import { formatTime } from "../lib/time";

test.skip(!process.env.E2E_REALISTIC, "needs the realistic backend");

type Theme = "light" | "dark";
interface FixtureNode {
  event_id: string;
  image: string;
  command_line: string | null;
  timestamp: string;
  event_type: string;
  rule_id: string | null;
}

const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "realistic", "incidents.json");
const incidents: { incident_id: string; chain: { nodes: FixtureNode[] } }[] = fs.existsSync(FIXTURE)
  ? JSON.parse(fs.readFileSync(FIXTURE, "utf-8"))
  : [];
const nodesOf = (id: string): FixtureNode[] => incidents.find((i) => i.incident_id === id)!.chain.nodes;
const nodeById = (id: string, eventId: string) => nodesOf(id).find((n) => n.event_id === eventId)!;

const GRAPH_DEFAULT = ["inc-1001", "inc-1002", "inc-1007"];
const TREE_DEFAULT = ["inc-1003", "inc-1004", "inc-1005", "inc-1006", "inc-1008"];

// Expected display order (event ids) and structure, written from the scenario
// definitions, not from the tree builder.
const EXPECTED: Record<string, { ids: string[]; depths: number[]; kinds: string[]; types: string[]; names: string[]; steps: number[] }> = {
  "inc-1006": {
    ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => `evt-s6-${String(n).padStart(2, "0")}`),
    depths: [0, 1, 2, 3, 3, 3, 3, 3, 4, 5, 4, 5, 4, 5],
    kinds: ["process", "process", "process", "process", "process", "process", "activity", "process", "process", "activity", "process", "activity", "process", "activity"],
    types: ["process_start", "process_start", "process_start", "process_start", "process_start", "process_start", "file_event", "process_start", "process_start", "registry_event", "process_start", "process_access", "process_start", "network_connection"],
    names: ["explorer.exe", "WINWORD.EXE", "powershell.exe", "whoami.exe", "net.exe", "reg.exe", "File write", "cmd.exe", "reg.exe", "Registry write", "rundll32.exe", "Process access", "powershell.exe", "Network connection"],
    steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  },
  "inc-1004": {
    ids: [1, 2, 3, 4, 5, 6, 8, 7].map((n) => `evt-s4-${String(n).padStart(2, "0")}`),
    depths: [0, 1, 2, 3, 4, 4, 5, 4],
    kinds: ["process", "process", "process", "process", "activity", "process", "activity", "activity"],
    types: ["process_start", "process_start", "process_start", "process_start", "file_event", "process_start", "registry_event", "network_connection"],
    names: ["explorer.exe", "WINWORD.EXE", "cmd.exe", "powershell.exe", "File write", "svc_update.exe", "Registry write", "Network connection"],
    steps: [1, 2, 3, 4, 5, 6, 8, 7],
  },
};

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

async function openIncident(page: Page, id: string, opts: { theme?: Theme; width?: number; height?: number } = {}) {
  const theme = opts.theme ?? "light";
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 });
  await page.goto(`/incidents/${id}`);
  await page.locator('[data-testid="attack-chain"]').waitFor();
  await page.waitForTimeout(400);
}

const card = (page: Page) => page.locator('[data-testid="attack-chain"]');
const tree = (page: Page) => card(page).locator('ol[aria-label="Process tree"]');
const graphRegion = (page: Page) => card(page).getByRole("region", { name: /Attack chain graph/ });
const toggle = (page: Page, name: "Graph" | "Tree") => card(page).getByRole("group", { name: "Chain view" }).getByRole("button", { name });

test.describe("chain tree on the realistic set", () => {
  test("fixtures are present", () => {
    expect(incidents).toHaveLength(8);
  });

  for (const id of GRAPH_DEFAULT) {
    test(`${id} defaults to the graph view`, async ({ page }) => {
      await openIncident(page, id);
      await expect(toggle(page, "Graph")).toHaveAttribute("aria-pressed", "true");
      await expect(toggle(page, "Tree")).toHaveAttribute("aria-pressed", "false");
      await expect(graphRegion(page)).toBeVisible();
      await expect(tree(page)).toHaveCount(0);
      await expect(card(page)).toContainText("Drag to pan. Hold Ctrl or Cmd and scroll to zoom.");
    });
  }

  for (const id of TREE_DEFAULT) {
    test(`${id} defaults to the tree view`, async ({ page }) => {
      await openIncident(page, id);
      await expect(toggle(page, "Tree")).toHaveAttribute("aria-pressed", "true");
      await expect(toggle(page, "Graph")).toHaveAttribute("aria-pressed", "false");
      await expect(tree(page)).toBeVisible();
      await expect(graphRegion(page)).toHaveCount(0);
      await expect(card(page).getByTestId("chain-row")).toHaveCount(nodesOf(id).length);
      await expect(card(page)).toContainText("Process tree. Numbers show the order events happened.");
    });
  }

  test("the toggle works both ways", async ({ page }) => {
    await openIncident(page, "inc-1006");
    await toggle(page, "Graph").click();
    await expect(toggle(page, "Graph")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "Tree")).toHaveAttribute("aria-pressed", "false");
    await expect(graphRegion(page)).toBeVisible();
    await expect(tree(page)).toHaveCount(0);
    await toggle(page, "Tree").click();
    await expect(toggle(page, "Tree")).toHaveAttribute("aria-pressed", "true");
    await expect(tree(page)).toBeVisible();
    await expect(graphRegion(page)).toHaveCount(0);

    await openIncident(page, "inc-1001");
    await toggle(page, "Tree").click();
    await expect(tree(page)).toBeVisible();
    await expect(graphRegion(page)).toHaveCount(0);
    await toggle(page, "Graph").click();
    await expect(graphRegion(page)).toBeVisible();
    await expect(tree(page)).toHaveCount(0);
  });

  for (const id of ["inc-1006", "inc-1004"]) {
    test(`${id} tree DOM matches the expected structure`, async ({ page }) => {
      const want = EXPECTED[id];
      await openIncident(page, id);
      const rows = card(page).getByTestId("chain-row");
      await expect(rows).toHaveCount(want.ids.length);

      const dom = await rows.evaluateAll((els) =>
        els.map((el) => ({
          depth: Number(el.getAttribute("data-depth")),
          kind: el.getAttribute("data-kind"),
          type: el.getAttribute("data-event-type"),
          step: Number(el.getAttribute("data-step")),
          name: el.querySelector('[data-testid="chain-row-name"]')?.textContent?.trim() ?? "",
          time: el.querySelector("time")?.textContent?.trim() ?? "",
          hasHitText: Array.from(el.querySelectorAll(".sr-only")).some((s) => s.textContent === "Detection hit"),
          hasRedIcon: el.querySelector("svg.text-red-500") !== null,
        })),
      );
      expect(dom.map((r) => r.depth)).toEqual(want.depths);
      expect(dom.map((r) => r.kind)).toEqual(want.kinds);
      expect(dom.map((r) => r.type)).toEqual(want.types);
      expect(dom.map((r) => r.name)).toEqual(want.names);
      expect(dom.map((r) => r.step)).toEqual(want.steps);

      dom.forEach((row, i) => {
        const node = nodeById(id, want.ids[i]);
        expect(row.time, want.ids[i]).toBe(formatTime(node.timestamp));
        expect(row.hasHitText, want.ids[i]).toBe(Boolean(node.rule_id));
        expect(row.hasRedIcon, want.ids[i]).toBe(Boolean(node.rule_id));
      });
      const expectedHits = nodesOf(id).filter((n) => n.rule_id).length;
      expect(dom.filter((r) => r.hasHitText)).toHaveLength(expectedHits);
      if (id === "inc-1006") expect(expectedHits).toBe(6);
    });
  }

  for (const [width, height, minCard] of [[1440, 900, 600], [390, 844, 250]] as const) {
    test(`inc-1006 tree geometry at ${width}x${height}`, async ({ page }) => {
      const want = EXPECTED["inc-1006"];
      await openIncident(page, "inc-1006", { width, height });
      const box = (await card(page).boundingBox())!;
      expect(box.width).toBeGreaterThan(minCard);

      const rows = card(page).getByTestId("chain-row");
      const lefts = await rows.evaluateAll((els) =>
        els.map((el) => ({
          depth: Number(el.getAttribute("data-depth")),
          left: (el.querySelector('[data-testid="chain-row-name"]') as HTMLElement).getBoundingClientRect().left,
        })),
      );
      for (let i = 1; i < lefts.length; i++) {
        if (lefts[i].depth === lefts[i - 1].depth + 1) {
          expect(lefts[i].left - lefts[i - 1].left, `row ${i}`).toBeGreaterThanOrEqual(12);
        }
      }

      // The existing Event timeline card overflows horizontally on long command
      // lines at phone width (pre-existing, EventTimeline is out of scope), so
      // it is hidden for the page-level check to isolate what the chain card adds.
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector("div.h-screen.overflow-y-auto") as HTMLElement | null;
        const c = document.querySelector('[data-testid="attack-chain"]') as HTMLElement;
        const list = c.querySelector("ol") as HTMLElement;
        const timeline = document.querySelector('[data-testid="event-timeline"]')?.closest(".rounded-lg") as HTMLElement | null;
        const timelineOverflow = scroller ? scroller.scrollWidth > scroller.clientWidth : false;
        if (timeline) timeline.style.display = "none";
        const result = {
          doc: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          scroller: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
          card: c.scrollWidth > c.clientWidth,
          list: list.scrollWidth > list.clientWidth,
        };
        if (timeline) timeline.style.display = "";
        console.log(`page overflows with the Event timeline visible: ${timelineOverflow}`);
        return result;
      });
      expect(overflow).toEqual({ doc: false, scroller: false, card: false, list: false });

      const names = await card(page).locator('[data-kind="process"] [data-testid="chain-row-name"]').evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent ?? "", fits: el.scrollWidth <= el.clientWidth })),
      );
      for (const n of names) {
        if (n.text.length <= 18) expect(n.fits, n.text).toBe(true);
      }

      const commands = await rows.evaluateAll((els) =>
        els.map((el) => el.querySelector('[data-testid="chain-row-command"]')?.getAttribute("title") ?? null),
      );
      commands.forEach((title, i) => {
        const node = nodeById("inc-1006", want.ids[i]);
        expect(title, want.ids[i]).toBe(node.event_type === "process_start" ? node.command_line : null);
      });

      const focusable = await card(page).locator("ol").evaluate((ol) => ({
        tabindex: ol.querySelectorAll("[tabindex]").length,
        interactive: ol.querySelectorAll("a, button, input, select, textarea").length,
        liTab: Array.from(ol.querySelectorAll("li")).every((li) => (li as HTMLElement).tabIndex === -1),
      }));
      expect(focusable).toEqual({ tabindex: 0, interactive: 0, liTab: true });
    });
  }

  for (const theme of ["light", "dark"] as Theme[]) {
    test(`no console errors or warnings across all incidents (${theme})`, async ({ page }) => {
      const issues = trackIssues(page);
      for (const incident of incidents) {
        await openIncident(page, incident.incident_id, { theme });
        await toggle(page, "Graph").click();
        await toggle(page, "Tree").click();
      }
      expect(issues).toEqual([]);
    });
  }

  const SHOTS: { id: string; theme: Theme; width: number; height: number; graph?: boolean }[] = [
    { id: "inc-1006", theme: "light", width: 1440, height: 900 },
    { id: "inc-1006", theme: "dark", width: 1440, height: 900 },
    { id: "inc-1006", theme: "light", width: 390, height: 844 },
    { id: "inc-1004", theme: "light", width: 1440, height: 900 },
    { id: "inc-1004", theme: "dark", width: 1440, height: 900 },
    { id: "inc-1008", theme: "light", width: 1440, height: 900 },
    { id: "inc-1003", theme: "light", width: 1440, height: 900 },
    { id: "inc-1001", theme: "light", width: 1440, height: 900, graph: true },
  ];
  for (const shot of SHOTS) {
    test(`screenshot ${shot.id} ${shot.graph ? "graph" : "tree"} ${shot.theme} ${shot.width}`, async ({ page }) => {
      const issues = trackIssues(page);
      await openIncident(page, shot.id, shot);
      if (shot.graph) await expect(graphRegion(page)).toBeVisible();
      else await expect(tree(page)).toBeVisible();
      // An element taller than the viewport inside the page scroller captures blank below the fold.
      await page.setViewportSize({ width: shot.width, height: 2400 });
      await page.waitForTimeout(300);
      const file = path.join(__dirname, "screenshots", `chain-tree-${shot.id}-${shot.theme}-${shot.width}.png`);
      await card(page).screenshot({ path: file });
      const dim = getPngDimensions(file);
      console.log(`Screenshot ${path.basename(file)}: ${dim.width}x${dim.height}`);
      expect(dim.width).toBeGreaterThan(shot.width === 390 ? 250 : 600);
      expect(dim.height).toBeGreaterThan(200);
      expect(issues).toEqual([]);
    });
  }
});
