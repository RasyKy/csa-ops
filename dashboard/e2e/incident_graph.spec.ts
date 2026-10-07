import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURES_INCIDENTS_PATH = path.join(__dirname, "../../fixtures/incidents.json");
const FIXTURES_ALERTS_PATH = path.join(__dirname, "../../fixtures/alerts.json");

interface FixtureNode {
  event_id: string;
  pid: number;
  ppid: number;
  image: string;
  command_line: string | null;
  timestamp: string;
  technique: string | null;
  rule_id: string | null;
  event_type?: string | null;
  host?: string | null;
  detail?: string | null;
}

interface FixtureIncident {
  incident_id: string;
  chain: {
    nodes: FixtureNode[];
    edges: Array<{ from: string; to: string; relation: string }>;
  };
}

const fixtureIncidents: Record<string, FixtureIncident> = {};
const fixtureRuleTitles: Record<string, string> = {};

try {
  const incRaw = JSON.parse(fs.readFileSync(FIXTURES_INCIDENTS_PATH, "utf-8")) as FixtureIncident[];
  for (const inc of incRaw) {
    fixtureIncidents[inc.incident_id] = inc;
  }
  const alertsRaw = JSON.parse(fs.readFileSync(FIXTURES_ALERTS_PATH, "utf-8")) as Array<{
    rule_id: string;
    rule_title: string;
  }>;
  for (const alert of alertsRaw) {
    if (alert.rule_id && alert.rule_title) {
      fixtureRuleTitles[alert.rule_id] = alert.rule_title;
    }
  }
} catch (e) {
  console.warn("Could not load fixtures:", e);
}

function basename(filePath: string): string {
  return filePath.split("\\").pop()?.split("/").pop() ?? filePath;
}

async function getViewportTransform(page: Page) {
  return await page.evaluate(() => {
    const el = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return { x: 0, y: 0, scale: 1 };
    const style = el.style.transform || window.getComputedStyle(el).transform;

    const translateMatch = style.match(/translate\(([^,]+)px?,\s*([^)]+)px?\)/);
    const scaleMatch = style.match(/scale\(([^)]+)\)/);
    if (translateMatch && scaleMatch) {
      return {
        x: Math.round(parseFloat(translateMatch[1]) * 100) / 100,
        y: Math.round(parseFloat(translateMatch[2]) * 100) / 100,
        scale: Math.round(parseFloat(scaleMatch[1]) * 1000) / 1000,
      };
    }

    const matrixMatch = style.match(/matrix\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (matrixMatch) {
      return {
        x: Math.round(parseFloat(matrixMatch[5]) * 100) / 100,
        y: Math.round(parseFloat(matrixMatch[6]) * 100) / 100,
        scale: Math.round(parseFloat(matrixMatch[1]) * 1000) / 1000,
      };
    }

    return { x: 0, y: 0, scale: 1 };
  });
}

test.describe("Attack chain graph tests", () => {
  test("unlocked interaction: pane drag, Ctrl+wheel, plain wheel, double click, node drag", async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const card = page.locator('[data-testid="attack-chain"]');
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();

    const pane = page.locator(".react-flow__pane");
    await expect(pane).toBeVisible();

    const paneBox = await pane.boundingBox();
    expect(paneBox).not.toBeNull();

    // 1. Dragging empty pane changes translate
    const t0 = await getViewportTransform(page);
    const startX = paneBox!.x + 60;
    const startY = paneBox!.y + 60;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 5 });
    await page.mouse.up();

    const t1 = await getViewportTransform(page);
    console.log("[Unlocked pane drag]", "before:", t0, "after:", t1);
    expect(t1.x !== t0.x || t1.y !== t0.y).toBe(true);

    // 2. Ctrl+wheel changes scale
    await page.keyboard.down("Control");
    await page.mouse.move(startX, startY);
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);

    const t2 = await getViewportTransform(page);
    console.log("[Unlocked Ctrl+wheel]", "before scale:", t1.scale, "after scale:", t2.scale);
    expect(t2.scale).not.toBe(t1.scale);

    // 3. Plain wheel does NOT change scale and DOES change window / scroll container scrollY
    const scrollContainer = page.locator("div.h-screen.min-w-0.flex-1.overflow-y-auto");
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 100;
    });
    const scrollBefore = await scrollContainer.evaluate((el) => el.scrollTop);
    const scaleBefore = (await getViewportTransform(page)).scale;

    await page.mouse.move(startX, startY);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);

    const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop);
    const scaleAfter = (await getViewportTransform(page)).scale;

    console.log(
      "[Unlocked plain wheel]",
      "scaleBefore:",
      scaleBefore,
      "scaleAfter:",
      scaleAfter,
      "scrollBefore:",
      scrollBefore,
      "scrollAfter:",
      scrollAfter,
    );
    expect(scaleAfter).toBe(scaleBefore);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);

    // 4. Double-click does not change scale
    const scaleBeforeDbl = (await getViewportTransform(page)).scale;
    await pane.dblclick({ position: { x: 80, y: 80 } });
    await page.waitForTimeout(100);
    const scaleAfterDbl = (await getViewportTransform(page)).scale;
    console.log("[Unlocked double-click]", "before:", scaleBeforeDbl, "after:", scaleAfterDbl);
    expect(scaleAfterDbl).toBe(scaleBeforeDbl);

    // 5. Dragging a node changes its bounding box
    const node = page.locator(".react-flow__node").first();
    const nodeBoxBefore = await node.boundingBox();
    expect(nodeBoxBefore).not.toBeNull();

    await page.mouse.move(nodeBoxBefore!.x + 30, nodeBoxBefore!.y + 20);
    await page.mouse.down();
    await page.mouse.move(nodeBoxBefore!.x + 90, nodeBoxBefore!.y + 70, { steps: 5 });
    await page.mouse.up();

    const nodeBoxAfter = await node.boundingBox();
    console.log(
      "[Unlocked node drag]",
      "before:",
      { x: nodeBoxBefore!.x, y: nodeBoxBefore!.y },
      "after:",
      { x: nodeBoxAfter!.x, y: nodeBoxAfter!.y },
    );
    expect(nodeBoxAfter!.x).not.toBe(nodeBoxBefore!.x);
    expect(nodeBoxAfter!.y).not.toBe(nodeBoxBefore!.y);

    const realErrors = consoleIssues.filter(
      (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("locked interaction: aria-pressed, disabled buttons, no movement, unlock restores", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const lockBtn = page.locator('button[aria-label="Lock graph"]');
    await expect(lockBtn).toBeVisible();

    // Click lock graph
    await lockBtn.click();
    await expect(lockBtn).toHaveAttribute("aria-pressed", "true");

    // Disabled buttons
    const zoomInBtn = page.locator('button[aria-label="Zoom in"]');
    const zoomOutBtn = page.locator('button[aria-label="Zoom out"]');
    const fitViewBtn = page.locator('button[aria-label="Fit view"]');
    await expect(zoomInBtn).toBeDisabled();
    await expect(zoomOutBtn).toBeDisabled();
    await expect(fitViewBtn).toBeDisabled();
    await expect(lockBtn).toBeEnabled();

    // Clicking disabled buttons does not change transform
    const tBase = await getViewportTransform(page);
    await zoomInBtn.click({ force: true });
    expect(await getViewportTransform(page)).toEqual(tBase);
    await zoomOutBtn.click({ force: true });
    expect(await getViewportTransform(page)).toEqual(tBase);
    await fitViewBtn.click({ force: true });
    expect(await getViewportTransform(page)).toEqual(tBase);

    const pane = page.locator(".react-flow__pane");
    // The graph starts low on this page (the case cards above it add height), so bring
    // it into view before aiming drags at it; a drag that ends below the viewport
    // never reaches the pane.
    await pane.scrollIntoViewIfNeeded();
    const paneBox = await pane.boundingBox();
    const startX = paneBox!.x + 60;
    const startY = paneBox!.y + 60;

    // Locked pane drag: transform is IDENTICAL
    const tBeforePaneDrag = await getViewportTransform(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60, { steps: 5 });
    await page.mouse.up();
    const tAfterPaneDrag = await getViewportTransform(page);
    console.log("[Locked pane drag]", "before:", tBeforePaneDrag, "after:", tAfterPaneDrag);
    expect(tAfterPaneDrag).toEqual(tBeforePaneDrag);

    // Locked node drag: node bounding box is IDENTICAL
    const node = page.locator(".react-flow__node").first();
    const nodeBoxBefore = await node.boundingBox();
    await page.mouse.move(nodeBoxBefore!.x + 30, nodeBoxBefore!.y + 20);
    await page.mouse.down();
    await page.mouse.move(nodeBoxBefore!.x + 80, nodeBoxBefore!.y + 60, { steps: 5 });
    await page.mouse.up();
    const nodeBoxAfter = await node.boundingBox();
    console.log("[Locked node drag]", "before:", nodeBoxBefore, "after:", nodeBoxAfter);
    expect(nodeBoxAfter).toEqual(nodeBoxBefore);

    // Locked Ctrl+wheel: transform is IDENTICAL
    const tBeforeWheel = await getViewportTransform(page);
    await page.keyboard.down("Control");
    await page.mouse.move(startX, startY);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);
    const tAfterWheel = await getViewportTransform(page);
    console.log("[Locked Ctrl+wheel]", "before:", tBeforeWheel, "after:", tAfterWheel);
    expect(tAfterWheel).toEqual(tBeforeWheel);

    // Locked double-click: transform is IDENTICAL
    const tBeforeDbl = await getViewportTransform(page);
    await pane.dblclick({ position: { x: 80, y: 80 } });
    await page.waitForTimeout(100);
    const tAfterDbl = await getViewportTransform(page);
    console.log("[Locked double-click]", "before:", tBeforeDbl, "after:", tAfterDbl);
    expect(tAfterDbl).toEqual(tBeforeDbl);

    // Click lock again -> unlocked! Pane drag changes transform again
    await lockBtn.click();
    await expect(lockBtn).toHaveAttribute("aria-pressed", "false");

    const tBeforeUnlockedAgain = await getViewportTransform(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 5 });
    await page.mouse.up();
    const tAfterUnlockedAgain = await getViewportTransform(page);
    console.log("[Re-unlocked pane drag]", "before:", tBeforeUnlockedAgain, "after:", tAfterUnlockedAgain);
    expect(tAfterUnlockedAgain.x !== tBeforeUnlockedAgain.x || tAfterUnlockedAgain.y !== tBeforeUnlockedAgain.y).toBe(
      true,
    );
  });

  test("mobile: locked by default at 390x844 and no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const lockBtn = page.locator('button[aria-label="Lock graph"]');
    await expect(lockBtn).toBeVisible();
    await expect(lockBtn).toHaveAttribute("aria-pressed", "true");

    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
  });

  test("dark mode: computed background of toolbar, legend, and edge label backgrounds equals --surface", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const surfaceColor = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    });

    const colors = await page.evaluate(() => {
      const toolbar = document.querySelector(".react-flow__panel.top.right > div");
      const legend = document.querySelector(".react-flow__panel.bottom.left > div");
      const edgeLabelBg = document.querySelector(".react-flow__edge-textbg");
      const attribution = document.querySelector(".react-flow__attribution");

      const getBg = (el: Element | null) => (el ? window.getComputedStyle(el).backgroundColor : null);
      const getFill = (el: Element | null) => (el ? window.getComputedStyle(el).fill : null);
      const getColor = (el: Element | null) => (el ? window.getComputedStyle(el).color : null);

      return {
        toolbarBg: getBg(toolbar),
        legendBg: getBg(legend),
        edgeLabelFill: getFill(edgeLabelBg),
        attributionBg: getBg(attribution),
        attributionColor: getColor(attribution),
      };
    });

    console.log("[Dark mode surface colors]", "token --surface:", surfaceColor, colors);
    // In dark mode: --surface is #131316 which is rgb(19, 19, 22)
    expect(colors.toolbarBg).toBe("rgb(19, 19, 22)");
    expect(colors.legendBg).toBe("rgb(19, 19, 22)");
    if (colors.edgeLabelFill) {
      expect(colors.edgeLabelFill).toBe("rgb(19, 19, 22)");
    }
    // (b) in dark mode the .react-flow__attribution computed background is transparent or equals --surface
    expect(
      colors.attributionBg === "rgba(0, 0, 0, 0)" ||
      colors.attributionBg === "transparent" ||
      colors.attributionBg === "rgb(19, 19, 22)"
    ).toBe(true);

    const inkSubtle = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.color = "var(--ink-subtle)";
      document.body.appendChild(el);
      const computed = window.getComputedStyle(el).color;
      el.remove();
      return computed;
    });
    expect(colors.attributionColor).toBe(inkSubtle);

    const attribution = page.locator(".react-flow__attribution");
    await expect(attribution).toBeVisible();
  });

  test("attribution: light mode background is transparent or equals --surface and text equals --ink-subtle", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const surfaceColor = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.backgroundColor = "var(--surface)";
      document.body.appendChild(el);
      const computed = window.getComputedStyle(el).backgroundColor;
      el.remove();
      return computed;
    });
    const inkSubtle = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.color = "var(--ink-subtle)";
      document.body.appendChild(el);
      const computed = window.getComputedStyle(el).color;
      el.remove();
      return computed;
    });

    const colors = await page.evaluate(() => {
      const attribution = document.querySelector(".react-flow__attribution");
      return {
        bg: attribution ? window.getComputedStyle(attribution).backgroundColor : null,
        color: attribution ? window.getComputedStyle(attribution).color : null,
      };
    });

    expect(
      colors.bg === "rgba(0, 0, 0, 0)" ||
      colors.bg === "transparent" ||
      colors.bg === surfaceColor ||
      colors.bg === "rgb(255, 255, 255)"
    ).toBe(true);
    expect(colors.color).toBe(inkSubtle);

    const attribution = page.locator(".react-flow__attribution");
    await expect(attribution).toBeVisible();
  });

  test("back link: clicking Incidents from inc-0003 navigates to /incidents", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0003");
    await page.waitForLoadState("networkidle");

    const backLink = page.getByRole("main").getByRole("link", { name: "Incidents" });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await page.waitForURL("**/incidents");
    expect(new URL(page.url()).pathname).toBe("/incidents");
  });

  // Skip duplicate 1920x1080 runs, since the canvas is 738px at any desktop width.
  for (const incId of ["inc-0002", "inc-0003", "inc-0004"]) {
    for (const theme of ["light", "dark"] as const) {
      test(`structure and node layout for ${incId} (${theme}, 1440x900)`, async ({ page }) => {
        const consoleIssues: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleIssues.push(`${msg.type()}: ${msg.text()}`);
          }
        });

        await page.addInitScript((t) => {
          localStorage.setItem("theme", t);
        }, theme);

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/incidents/${incId}`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator(".react-flow__node").first()).toBeVisible();

        // 1. No top or bottom handles
        const forbiddenHandles = page.locator(".react-flow__handle-top, .react-flow__handle-bottom");
        expect.soft(await forbiddenHandles.count()).toBe(0);

        // 2. Node count: .react-flow__node-event count equals node count, no .react-flow__node-default
        const nodes = page.locator(".react-flow__node");
        const nodeCount = await nodes.count();
        const eventNodes = page.locator(".react-flow__node-event");
        const defaultNodes = page.locator(".react-flow__node-default");
        expect.soft(await eventNodes.count()).toBe(nodeCount);
        expect.soft(await defaultNodes.count()).toBe(0);

        const fixture = fixtureIncidents[incId];
        const expectedNodes = fixture ? fixture.chain.nodes : [];
        expect.soft(nodeCount).toBe(expectedNodes.length);

        // 3. Viewport scale and canvas logging
        const canvas = page.locator(".react-flow");
        const canvasBox = await canvas.boundingBox();
        expect.soft(canvasBox).not.toBeNull();

        const { scale } = await getViewportTransform(page);
        console.log(`[${incId} ${theme} 1440x900] canvas: ${canvasBox?.width}x${canvasBox?.height}, scale: ${scale}`);
        expect.soft(scale).toBeGreaterThanOrEqual(0.99);

        // 4. Rendered font size >= 10.9px for node text and edge labels
        const nodeFontSizes = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll(".react-flow__node *"));
          return els
            .filter((e) => e.children.length === 0 && (e.textContent?.trim().length ?? 0) > 0)
            .map((e) => parseFloat(window.getComputedStyle(e).fontSize));
        });
        for (const fsVal of nodeFontSizes) {
          const renderedFs = fsVal * scale;
          expect.soft(renderedFs).toBeGreaterThanOrEqual(10.9);
        }

        const edgeFontSizes = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll(".react-flow__edge-text"));
          return els.map((e) => parseFloat(window.getComputedStyle(e).fontSize));
        });
        for (const fsVal of edgeFontSizes) {
          const renderedFs = fsVal * scale;
          expect.soft(renderedFs).toBeGreaterThanOrEqual(10.9);
        }

        // 5. Node dimensions: width 184px, height 84px (+/- 1px) for all nodes
        const nodeBoxes: { x: number; y: number; width: number; height: number }[] = [];
        for (let i = 0; i < nodeCount; i++) {
          const nBox = await nodes.nth(i).boundingBox();
          expect.soft(nBox).not.toBeNull();
          if (nBox) {
            nodeBoxes.push(nBox);
            expect.soft(Math.abs(nBox.height - 84), `Node ${i} height is 84px (+/- 1px)`).toBeLessThanOrEqual(1);
            expect.soft(Math.abs(nBox.width - 184), `Node ${i} width is 184px (+/- 1px)`).toBeLessThanOrEqual(1);
            expect.soft(nBox.x).toBeGreaterThanOrEqual(canvasBox!.x + 8);
            expect.soft(nBox.y).toBeGreaterThanOrEqual(canvasBox!.y + 8);
            expect.soft(nBox.x + nBox.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width - 8);
            expect.soft(nBox.y + nBox.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height - 8);
          }
        }

        // 6. Horizontal gap between adjacent node boxes >= 72px (dagre ranksep 74)
        const uniqueX = Array.from(new Set(nodeBoxes.map((b) => Math.round(b.x)))).sort((a, b) => a - b);
        for (let i = 0; i < uniqueX.length - 1; i++) {
          const gap = uniqueX[i + 1] - (uniqueX[i] + 184);
          expect.soft(gap, `Horizontal gap between rank ${i} and rank ${i + 1} >= 72px`).toBeGreaterThanOrEqual(72);
        }
        if (fixture) {
          for (const edge of fixture.chain.edges) {
            const srcIdx = expectedNodes.findIndex((n) => n.event_id === edge.from);
            const tgtIdx = expectedNodes.findIndex((n) => n.event_id === edge.to);
            if (srcIdx !== -1 && tgtIdx !== -1 && nodeBoxes[srcIdx] && nodeBoxes[tgtIdx]) {
              const edgeGap = nodeBoxes[tgtIdx].x - (nodeBoxes[srcIdx].x + nodeBoxes[srcIdx].width);
              expect.soft(edgeGap, `Horizontal gap along edge ${edge.from}->${edge.to} >= 72px`).toBeGreaterThanOrEqual(72);
            }
          }
        }

        // 7. No edge label bounding box intersects any node bounding box; for horizontal edges label bottom <= line y + 1
        const edgeElements = page.locator(".react-flow__edge");
        const edgeCount = await edgeElements.count();
        for (let i = 0; i < edgeCount; i++) {
          const edgeEl = edgeElements.nth(i);
          const labelEl = edgeEl.locator(".react-flow__edge-text");
          if ((await labelEl.count()) === 0) continue;
          const lBox = await labelEl.boundingBox();
          if (!lBox) continue;

          for (let j = 0; j < nodeCount; j++) {
            const nBox = nodeBoxes[j];
            if (!nBox) continue;
            const intersects = !(
              lBox.x + lBox.width <= nBox.x ||
              nBox.x + nBox.width <= lBox.x ||
              lBox.y + lBox.height <= nBox.y ||
              nBox.y + nBox.height <= lBox.y
            );
            expect.soft(intersects, `Edge label ${i} intersects node ${j}`).toBe(false);
          }

          const pathEl = edgeEl.locator(".react-flow__edge-path");
          const pathBox = await pathEl.boundingBox();
          if (pathBox && pathBox.height <= 6) {
            expect.soft(
              lBox.y + lBox.height,
              `Straight horizontal edge label ${i} bottom <= edge line y + 1`,
            ).toBeLessThanOrEqual(pathBox.y + 1);
          }
        }

        // 8. Toolbar and legend clearance and intersections
        const toolbar = page.locator(".react-flow__panel.top.right");
        const toolbarBox = await toolbar.boundingBox();
        if (toolbarBox) {
          for (let j = 0; j < nodeCount; j++) {
            const nBox = nodeBoxes[j];
            if (!nBox) continue;
            const intersects = !(
              toolbarBox.x + toolbarBox.width <= nBox.x ||
              nBox.x + nBox.width <= toolbarBox.x ||
              toolbarBox.y + toolbarBox.height <= nBox.y ||
              nBox.y + nBox.height <= toolbarBox.y
            );
            expect.soft(intersects, `Toolbar intersects node ${j}`).toBe(false);

            const verticalClearance = nBox.y - (toolbarBox.y + toolbarBox.height);
            expect.soft(verticalClearance, `Toolbar clearance to node ${j} >= 12px`).toBeGreaterThanOrEqual(12);
          }
        }

        const legend = page.locator(".react-flow__panel.bottom.left");
        const legendBox = await legend.boundingBox();
        if (legendBox) {
          for (let j = 0; j < nodeCount; j++) {
            const nBox = nodeBoxes[j];
            if (!nBox) continue;
            const intersects = !(
              legendBox.x + legendBox.width <= nBox.x ||
              nBox.x + nBox.width <= legendBox.x ||
              legendBox.y + legendBox.height <= nBox.y ||
              nBox.y + nBox.height <= legendBox.y
            );
            expect.soft(intersects, `Legend intersects node ${j}`).toBe(false);
          }
        }

        // 9. Empty space above and below node group <= 96px each
        let minNodeY = Infinity;
        let maxNodeY = -Infinity;
        for (let i = 0; i < nodeBoxes.length; i++) {
          minNodeY = Math.min(minNodeY, nodeBoxes[i].y);
          maxNodeY = Math.max(maxNodeY, nodeBoxes[i].y + nodeBoxes[i].height);
        }
        const spaceAbove = minNodeY - canvasBox!.y;
        const spaceBelow = canvasBox!.y + canvasBox!.height - maxNodeY;
        expect.soft(spaceAbove).toBeLessThanOrEqual(96);
        expect.soft(spaceBelow).toBeLessThanOrEqual(96);

        // 10. Step numbers and detection hit tags matching fixtures
        const sortedExpected = [...expectedNodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const expectedStepMap: Record<string, number> = {};
        sortedExpected.forEach((n, idx) => {
          expectedStepMap[n.event_id] = idx + 1;
        });

        for (const fNode of expectedNodes) {
          const nodeEl = page.locator(`.react-flow__node[data-id="${fNode.event_id}"]`);
          await expect(nodeEl).toBeVisible();

          const stepEl = nodeEl.locator("span.font-mono.rounded-full");
          await expect(stepEl).toBeVisible();
          const stepText = (await stepEl.textContent())?.trim();
          expect.soft(parseInt(stepText || "0", 10), `Step number for ${fNode.event_id}`).toBe(
            expectedStepMap[fNode.event_id],
          );

          const procEl = nodeEl.locator("span.font-mono").nth(1);
          await expect(procEl).toBeVisible();
          const procText = (await procEl.textContent())?.trim();
          const expectedName = basename(fNode.image);

          expect.soft(procText).toBe(expectedName);
          expect.soft(procText?.includes("...")).toBe(false);
          expect.soft(procText?.includes("\u2026")).toBe(false);

          const procOverflow = await procEl.evaluate((el) => el.scrollWidth > el.clientWidth);
          expect.soft(procOverflow, `Process name "${procText}" scrollWidth <= clientWidth`).toBe(false);

          const expectedRuleTitle = fNode.rule_id ? fixtureRuleTitles[fNode.rule_id] : null;
          if (fNode.rule_id && expectedRuleTitle) {
            const ruleEl = nodeEl.locator("div.leading-4");
            await expect(ruleEl).toBeVisible();
            const ruleText = (await ruleEl.textContent())?.trim();
            expect.soft(ruleText).toBe(expectedRuleTitle);

            const ruleOverflow = await ruleEl.evaluate((el) => el.scrollWidth > el.clientWidth);
            expect.soft(ruleOverflow, `Rule title "${ruleText}" scrollWidth <= clientWidth`).toBe(false);

            const srLabel = nodeEl.locator(".sr-only");
            expect.soft(await srLabel.textContent()).toBe("Detection hit");
          } else {
            const nonHitEl = nodeEl.locator("div.leading-4");
            await expect(nonHitEl).toBeVisible();
            const expectedRow3 = fNode.detail ?? "No rule matched";
            const actualRow3 = (await nonHitEl.textContent())?.trim();
            console.log(`[${incId} ${theme} node ${fNode.event_id}] Non-hit row 3: "${actualRow3}", expected: "${expectedRow3}"`);
            expect.soft(actualRow3).toBe(expectedRow3);

            const row2El = nodeEl.locator("div.flex.items-center.justify-between");
            const row2Spans = await row2El.locator("span").allTextContents();
            const row2Text = row2Spans.map((s) => s.trim()).filter(Boolean).join(" ");
            const expectedLabel =
              fNode.event_type && fNode.event_type !== "process_start"
                ? fNode.event_type === "network_connection"
                  ? "Network"
                  : fNode.event_type === "file_event"
                    ? "File"
                    : fNode.event_type === "registry_event"
                      ? "Registry"
                      : "Process access"
                : null;
            const expectedRow2 = expectedLabel ? `pid ${fNode.pid} ${expectedLabel}` : `pid ${fNode.pid}`;
            console.log(`[${incId} ${theme} node ${fNode.event_id}] Non-hit row 2: "${row2Text}", expected: "${expectedRow2}"`);
            expect.soft(row2Text).toBe(expectedRow2);
          }
        }

        // 11. Process name evaluation check: powershell_ise.exe vs 24-character name
        const evalResult = await page.evaluate(() => {
          const firstNode = document.querySelector(".react-flow__node-event");
          if (!firstNode) return { error: "no event node" };
          const nameEls = firstNode.querySelectorAll("span.font-mono");
          const nameEl = nameEls.length > 1 ? nameEls[1] : null;
          if (!nameEl) return { error: "no name element" };

          const originalText = nameEl.textContent;

          // 1. Set to powershell_ise.exe (18 chars)
          nameEl.textContent = "powershell_ise.exe";
          const iseOverflow = nameEl.scrollWidth > nameEl.clientWidth;

          // 2. Set to 24-char name
          nameEl.textContent = "process_name_24_char.exe";
          const longOverflow = nameEl.scrollWidth > nameEl.clientWidth;
          const hasTitle = nameEl.hasAttribute("title") && Boolean(nameEl.getAttribute("title"));

          // Restore
          nameEl.textContent = originalText;

          return { iseOverflow, longOverflow, hasTitle };
        });
        expect.soft(evalResult.iseOverflow, "powershell_ise.exe does not overflow").toBe(false);
        expect.soft(evalResult.longOverflow, "24-character name overflows").toBe(true);
        expect.soft(evalResult.hasTitle, "Title attribute present").toBe(true);

        // 12. Legend swatches
        const lineStrong = await page.evaluate(() => {
          const div = document.createElement("div");
          div.style.borderColor = "var(--line-strong)";
          document.body.appendChild(div);
          const color = window.getComputedStyle(div).borderColor;
          div.remove();
          return color;
        });

        const swatches = legend.locator("span.h-2\\.5.w-2\\.5");
        const hitBorder = await swatches.nth(0).evaluate((el) => window.getComputedStyle(el).borderColor);
        const eventBorder = await swatches.nth(1).evaluate((el) => window.getComputedStyle(el).borderColor);

        expect.soft(eventBorder).toBe(lineStrong);
        expect.soft(eventBorder).not.toBe(hitBorder);

        // 13. Tooltip check: hover all four toolbar buttons, assert within container rect, inside non-visible ancestors, pointer-events none
        const toolbarButtons = [
          { label: "Zoom in", selector: 'button[aria-label="Zoom in"]' },
          { label: "Zoom out", selector: 'button[aria-label="Zoom out"]' },
          { label: "Fit view", selector: 'button[aria-label="Fit view"]' },
          { label: "Lock", selector: 'button[aria-label="Lock graph"]' },
        ];

        for (const btn of toolbarButtons) {
          const buttonEl = page.locator(btn.selector);
          await expect(buttonEl).toBeVisible();
          await buttonEl.hover();
          const tooltip = page.locator('[role="tooltip"]');
          await expect(tooltip).toBeVisible();
          const tooltipBox = await tooltip.boundingBox();
          const rfBox = await canvas.boundingBox();
          expect.soft(tooltipBox).not.toBeNull();
          expect.soft(rfBox).not.toBeNull();

          console.log(`[Tooltip ${btn.label}] tooltip rect:`, tooltipBox, "container rect:", rfBox);

          if (tooltipBox && rfBox) {
            expect.soft(tooltipBox.x).toBeGreaterThanOrEqual(rfBox.x);
            expect.soft(tooltipBox.y).toBeGreaterThanOrEqual(rfBox.y);
            expect.soft(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(rfBox.x + rfBox.width + 1);
            expect.soft(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(rfBox.y + rfBox.height + 1);

            const tooltipDetails = await page.evaluate(() => {
              const tip = document.querySelector('[role="tooltip"]');
              if (!tip) return null;
              const computed = window.getComputedStyle(tip);
              const pointerEvents = computed.pointerEvents;
              const tRect = tip.getBoundingClientRect();
              const ancestors: Array<{
                tag: string;
                className: string;
                overflowX: string;
                overflowY: string;
                rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
              }> = [];

              let current = tip.parentElement;
              while (current) {
                const s = window.getComputedStyle(current);
                if (s.overflowX !== "visible" || s.overflowY !== "visible") {
                  const r = current.getBoundingClientRect();
                  ancestors.push({
                    tag: current.tagName.toLowerCase(),
                    className: current.className,
                    overflowX: s.overflowX,
                    overflowY: s.overflowY,
                    rect: {
                      left: r.left,
                      top: r.top,
                      right: r.right,
                      bottom: r.bottom,
                      width: r.width,
                      height: r.height,
                    },
                  });
                }
                current = current.parentElement;
              }

              return {
                pointerEvents,
                tipRect: {
                  left: tRect.left,
                  top: tRect.top,
                  right: tRect.right,
                  bottom: tRect.bottom,
                  width: tRect.width,
                  height: tRect.height,
                },
                ancestors,
              };
            });

            expect.soft(tooltipDetails).not.toBeNull();
            if (tooltipDetails) {
              expect.soft(tooltipDetails.pointerEvents, `${btn.label} tooltip pointer-events is none`).toBe("none");

              console.log(
                `[Tooltip ${btn.label}] Checked ancestors:`,
                tooltipDetails.ancestors.map(
                  (a) =>
                    `${a.tag}${a.className ? "." + a.className.split(" ").join(".") : ""} (overflow-x: ${a.overflowX}, overflow-y: ${a.overflowY}) rect: [${a.rect.left}, ${a.rect.top}, ${a.rect.right}, ${a.rect.bottom}]`,
                ),
              );

              for (const anc of tooltipDetails.ancestors) {
                expect.soft(
                  tooltipDetails.tipRect.left >= anc.rect.left - 0.5,
                  `${btn.label} tooltip left (${tooltipDetails.tipRect.left}) >= ancestor ${anc.tag} left (${anc.rect.left}) - 0.5`,
                ).toBe(true);
                expect.soft(
                  tooltipDetails.tipRect.top >= anc.rect.top - 0.5,
                  `${btn.label} tooltip top (${tooltipDetails.tipRect.top}) >= ancestor ${anc.tag} top (${anc.rect.top}) - 0.5`,
                ).toBe(true);
                expect.soft(
                  tooltipDetails.tipRect.right <= anc.rect.right + 0.5,
                  `${btn.label} tooltip right (${tooltipDetails.tipRect.right}) <= ancestor ${anc.tag} right (${anc.rect.right}) + 0.5`,
                ).toBe(true);
                expect.soft(
                  tooltipDetails.tipRect.bottom <= anc.rect.bottom + 0.5,
                  `${btn.label} tooltip bottom (${tooltipDetails.tipRect.bottom}) <= ancestor ${anc.tag} bottom (${anc.rect.bottom}) + 0.5`,
                ).toBe(true);
              }

              if (btn.label === "Lock") {
                expect.soft(
                  tooltipDetails.tipRect.right,
                  `Lock button tooltip right edge (${tooltipDetails.tipRect.right}) <= .react-flow container right edge (${rfBox.x + rfBox.width}) - 4px`,
                ).toBeLessThanOrEqual(rfBox.x + rfBox.width - 4);
              }
            }
          }

          // Move mouse away to clear tooltip before testing next button
          await page.mouse.move(0, 0);
          await expect(tooltip).not.toBeVisible();
        }

        // 14. Console error/warning check: zero errors/warnings, no React Flow filtering
        const realErrors = consoleIssues.filter(
          (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
        );
        expect.soft(realErrors).toHaveLength(0);

        // Check soft failures and report them
        if (test.info().errors.length > 0) {
          console.log(`[${incId} ${theme}] Failed checks:`, test.info().errors.map((e) => e.message));
        }
        expect(test.info().errors).toHaveLength(0);
      });
    }
  }

  test.describe("Attack chain visual captures", () => {
    const CAPTURES = [
      { id: "inc-0002", theme: "light", width: 1440, height: 900, locked: false },
      { id: "inc-0002", theme: "dark", width: 1440, height: 900, locked: false },
      { id: "inc-0003", theme: "light", width: 1440, height: 900, locked: false },
      { id: "inc-0003", theme: "dark", width: 1440, height: 900, locked: false },
      { id: "inc-0004", theme: "light", width: 1440, height: 900, locked: false },
      { id: "inc-0004", theme: "dark", width: 1440, height: 900, locked: false },
      { id: "inc-0004", theme: "light", width: 390, height: 844, locked: false },
      { id: "inc-0004", theme: "light", width: 1440, height: 900, locked: true },
    ];

    for (const item of CAPTURES) {
      test(`capture ${item.id} ${item.theme} ${item.width}${item.locked ? " locked" : ""}`, async ({ page }) => {
        await page.addInitScript((t) => {
          localStorage.setItem("theme", t);
        }, item.theme);

        await page.setViewportSize({ width: item.width, height: item.height });
        await page.goto(`/incidents/${item.id}`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);

        if (item.locked && item.width >= 768) {
          const lockBtn = page.locator('button[aria-label="Lock graph"]');
          await lockBtn.click();
          await page.waitForTimeout(200);
        }

        const card = page.locator('[data-testid="attack-chain"]');
        const cardBox = await card.boundingBox();
        expect(cardBox).not.toBeNull();

        const lockSuffix = item.locked ? "-locked" : "";
        const filename = `attack-chain-${item.id}-${item.theme}-${item.width}${lockSuffix}-v5.png`;

        await card.screenshot({
          path: `e2e/screenshots/${filename}`,
        });

        if (item.width === 390) {
          expect(cardBox!.width).toBeGreaterThan(250);
        } else {
          expect(cardBox!.width).toBeGreaterThan(600);
        }
        expect(cardBox!.height).toBeGreaterThan(150);
      });
    }
  });
});

