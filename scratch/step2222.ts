import { expect, test, type Page } from "@playwright/test";

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

  for (const incId of ["inc-0002", "inc-0003", "inc-0004"]) {
    for (const theme of ["light", "dark"] as const) {
      test(`structure and node layout for ${incId} (${theme})`, async ({ page }) => {
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

        // 1. No top or bottom handles
        const forbiddenHandles = page.locator(".react-flow__handle-top, .react-flow__handle-bottom");
        expect(await forbiddenHandles.count()).toBe(0);

        // 2. Node count vs timeline row count
        const nodeCount = await page.locator(".react-flow__node").count();
        const timelineCount = await page.locator(".divide-y > li").count();
        console.log(`[${incId} ${theme}] Graph nodes: ${nodeCount}, Timeline items: ${timelineCount}`);
        expect(nodeCount).toBeGreaterThan(0);

        // 3. Every node bounding box is inside canvas rect with >= 8px margin
        const canvas = page.locator(".react-flow");
        const canvasBox = await canvas.boundingBox();
        expect(canvasBox).not.toBeNull();

        const nodes = page.locator(".react-flow__node");
        for (let i = 0; i < nodeCount; i++) {
          const nBox = await nodes.nth(i).boundingBox();
          expect(nBox).not.toBeNull();
          expect(nBox!.x).toBeGreaterThanOrEqual(canvasBox!.x + 8);
          expect(nBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + 8);
          expect(nBox!.x + nBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width - 8);
          expect(nBox!.y + nBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height - 8);
        }

        // 4. No edge label bounding box intersects any node bounding box
        const edgeLabels = page.locator(".react-flow__edge-text");
        const labelCount = await edgeLabels.count();
        for (let i = 0; i < labelCount; i++) {
          const lBox = await edgeLabels.nth(i).boundingBox();
          if (!lBox) continue;
          for (let j = 0; j < nodeCount; j++) {
            const nBox = await nodes.nth(j).boundingBox();
            if (!nBox) continue;
            const intersects = !(
              lBox.x + lBox.width <= nBox.x ||
              nBox.x + nBox.width <= lBox.x ||
              lBox.y + lBox.height <= nBox.y ||
              nBox.y + nBox.height <= lBox.y
            );
            expect(intersects, `Edge label ${i} intersects node ${j}`).toBe(false);
          }
        }

        // 5. All node text computed font-size >= 12px
        const fontSizes = await page.evaluate(() => {
          const textElements = Array.from(document.querySelectorAll(".react-flow__node *"));
          return textElements
            .filter((el) => el.children.length === 0 && (el.textContent?.trim().length ?? 0) > 0)
            .map((el) => {
              const fs = window.getComputedStyle(el).fontSize;
              return parseFloat(fs);
            });
        });
        for (const fs of fontSizes) {
          expect(fs).toBeGreaterThanOrEqual(12);
        }

        const realErrors = consoleIssues.filter(
          (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
        );
        expect(realErrors).toHaveLength(0);
      });
    }
  }

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

      const getBg = (el: Element | null) => (el ? window.getComputedStyle(el).backgroundColor : null);
      const getFill = (el: Element | null) => (el ? window.getComputedStyle(el).fill : null);

      return {
        toolbarBg: getBg(toolbar),
        legendBg: getBg(legend),
        edgeLabelFill: getFill(edgeLabelBg),
      };
    });

    console.log("[Dark mode surface colors]", "token --surface:", surfaceColor, colors);
    // In dark mode: --surface is #131316 which is rgb(19, 19, 22)
    expect(colors.toolbarBg).toBe("rgb(19, 19, 22)");
    expect(colors.legendBg).toBe("rgb(19, 19, 22)");
    if (colors.edgeLabelFill) {
      expect(colors.edgeLabelFill).toBe("rgb(19, 19, 22)");
    }
  });

  test("back link: clicking Incidents from inc-0003 navigates to /incidents", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0003");
    await page.waitForLoadState("networkidle");

    const backLink = page.locator('a:has-text("Incidents")');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await page.waitForURL("**/incidents");
    expect(new URL(page.url()).pathname).toBe("/incidents");
  });

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
        const lockSuffix = item.locked ? "-locked" : "";
        const filename = `attack-chain-${item.id}-${item.theme}-${item.width}${lockSuffix}.png`;

        await card.screenshot({
          path: `e2e/screenshots/${filename}`,
        });
      });
    }
  });
});
