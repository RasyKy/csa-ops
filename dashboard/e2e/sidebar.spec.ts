import { expect, test } from "@playwright/test";

// Visual verification for the sidebar nav redesign: expanded/collapsed x
// light/dark x two desktop widths, plus one narrow width proving the
// automatic max-md collapse. Screenshots are reviewed by hand; this spec
// doesn't assert anything itself.
const WIDTHS = [1440, 1920];
const THEMES: ("light" | "dark")[] = ["light", "dark"];

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`sidebar expanded ${theme} ${width}`, async ({ page }) => {
      await page.addInitScript(
        (t) => {
          localStorage.setItem("theme", t);
          localStorage.setItem("sidebar-collapsed", "false");
        },
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/screenshots/sidebar-expanded-${theme}-${width}.png`, fullPage: false });
    });

    test(`sidebar collapsed ${theme} ${width}`, async ({ page }) => {
      await page.addInitScript(
        (t) => {
          localStorage.setItem("theme", t);
          localStorage.setItem("sidebar-collapsed", "true");
        },
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/screenshots/sidebar-collapsed-${theme}-${width}.png`, fullPage: false });
    });
  }
}

// Proof of the automatic max-md icon-rail collapse at a narrow width, even
// with sidebar-collapsed explicitly "false" in storage.
test("sidebar auto-collapse at narrow width (640, light)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("sidebar-collapsed", "false");
  });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/screenshots/sidebar-narrow-640.png", fullPage: false });
});

// Active-item highlight on the Incidents route, for a quick visual check
// that the accent bar follows navigation correctly.
test("sidebar active item on /incidents (dark)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("sidebar-collapsed", "false");
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/incidents");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/screenshots/sidebar-active-incidents-dark-1440.png", fullPage: false });
});

test.describe("sidebar resizing behavior", () => {
  test("default width equals 240, drag +120px gives 360, drag +500px clamps to 360, drag -500px clamps to 200", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");
      localStorage.removeItem("csa-sidebar-width");
      localStorage.setItem("sidebar-collapsed", "false");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside");
    const handle = page.locator('div[role="separator"][aria-label="Resize sidebar"]');
    await expect(handle).toBeVisible();

    // Default width check
    const initialBox = await sidebar.boundingBox();
    expect(initialBox).not.toBeNull();
    expect(Math.round(initialBox!.width)).toBe(240);

    // Drag +120px -> 360
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startY = handleBox!.y + 100;
    const startX = handleBox!.x + handleBox!.width / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY, { steps: 5 });
    await page.mouse.up();

    const boxPlus120 = await sidebar.boundingBox();
    expect(Math.round(boxPlus120!.width)).toBe(360);

    // Drag +500px -> clamped to 360
    const handleBox2 = await handle.boundingBox();
    const startX2 = handleBox2!.x + handleBox2!.width / 2;
    await page.mouse.move(startX2, startY);
    await page.mouse.down();
    await page.mouse.move(startX2 + 500, startY, { steps: 5 });
    await page.mouse.up();

    const boxPlus500 = await sidebar.boundingBox();
    expect(Math.round(boxPlus500!.width)).toBe(360);

    // Drag -500px -> clamped to 200
    const handleBox3 = await handle.boundingBox();
    const startX3 = handleBox3!.x + handleBox3!.width / 2;
    await page.mouse.move(startX3, startY);
    await page.mouse.down();
    await page.mouse.move(startX3 - 500, startY, { steps: 5 });
    await page.mouse.up();

    const boxMinus500 = await sidebar.boundingBox();
    expect(Math.round(boxMinus500!.width)).toBe(200);

    // Drag with Escape cancels and restores starting width
    const handleBox4 = await handle.boundingBox();
    const startX4 = handleBox4!.x + handleBox4!.width / 2;
    await page.mouse.move(startX4, startY);
    await page.mouse.down();
    await page.mouse.move(startX4 + 60, startY, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();

    const boxCancelled = await sidebar.boundingBox();
    expect(Math.round(boxCancelled!.width)).toBe(200);
  });

  test("keyboard: ArrowRight adds 16, ArrowLeft subtracts 16, Home gives 200, End gives 360, double-click resets to 240", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");
      localStorage.removeItem("csa-sidebar-width");
      localStorage.setItem("sidebar-collapsed", "false");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside");
    const handle = page.locator('div[role="separator"][aria-label="Resize sidebar"]');

    await handle.focus();
    await expect(handle).toBeFocused();

    // ArrowRight -> 240 + 16 = 256
    await page.keyboard.press("ArrowRight");
    let box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(256);
    expect(await handle.getAttribute("aria-valuenow")).toBe("256");

    // ArrowLeft -> 256 - 16 = 240
    await page.keyboard.press("ArrowLeft");
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(240);
    expect(await handle.getAttribute("aria-valuenow")).toBe("240");

    // Home -> 200
    await page.keyboard.press("Home");
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(200);
    expect(await handle.getAttribute("aria-valuenow")).toBe("200");

    // End -> 360
    await page.keyboard.press("End");
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(360);
    expect(await handle.getAttribute("aria-valuenow")).toBe("360");

    // Double-click resets to DEFAULT_W (240)
    await handle.dblclick();
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(240);
    expect(await handle.getAttribute("aria-valuenow")).toBe("240");

    // Enter also resets to DEFAULT_W
    await page.keyboard.press("ArrowRight");
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(256);
    await page.keyboard.press("Enter");
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(240);
  });

  test("reload keeps custom width with no flash", async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    const savedWidth = 310;
    await page.addInitScript((w) => {
      localStorage.setItem("theme", "light");
      localStorage.setItem("csa-sidebar-width", String(w));
      localStorage.setItem("sidebar-collapsed", "false");

      (window as unknown as { __sidebarWidths: number[] }).__sidebarWidths = [];
      (window as unknown as { __sidebarCssVarAtDOMContentLoaded?: string }).__sidebarCssVarAtDOMContentLoaded = undefined;

      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __sidebarCssVarAtDOMContentLoaded?: string }).__sidebarCssVarAtDOMContentLoaded =
          document.documentElement.style.getPropertyValue("--sidebar-width");
      });

      function recordFrame() {
        const aside = document.querySelector("aside");
        if (aside) {
          const width = Math.round(aside.getBoundingClientRect().width);
          (window as unknown as { __sidebarWidths: number[] }).__sidebarWidths.push(width);
        }
        requestAnimationFrame(recordFrame);
      }
      requestAnimationFrame(recordFrame);
    }, savedWidth);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    const { recordedWidths, cssVarAtDomLoaded, currentCssVar } = await page.evaluate(() => {
      const w = window as unknown as {
        __sidebarWidths: number[];
        __sidebarCssVarAtDOMContentLoaded?: string;
      };
      return {
        recordedWidths: w.__sidebarWidths,
        cssVarAtDomLoaded: w.__sidebarCssVarAtDOMContentLoaded,
        currentCssVar: document.documentElement.style.getPropertyValue("--sidebar-width"),
      };
    });

    console.log("Recorded sidebar widths on rAF:", recordedWidths);
    console.log("--sidebar-width at DOMContentLoaded:", cssVarAtDomLoaded);
    console.log("Current --sidebar-width:", currentCssVar);

    // 1. Assert --sidebar-width on <html> equals 310px by the time DOMContentLoaded fires
    expect(cssVarAtDomLoaded).toBe(`${savedWidth}px`);
    expect(currentCssVar).toBe(`${savedWidth}px`);

    // 2. Assert aside existed and recorded frames
    expect(recordedWidths.length).toBeGreaterThan(0);

    // 3. Assert first recorded value is 310
    expect(recordedWidths[0]).toBe(savedWidth);

    // 4. Assert no recorded value equals 240
    expect(recordedWidths).not.toContain(240);

    // 5. Zero console warnings (including hydration)
    const warnings = consoleIssues.filter((i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"));
    expect(warnings).toHaveLength(0);

    const sidebar = page.locator("aside");
    const box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(savedWidth);
  });

  test("collapsed reload keeps 64px with no flash and toggles smoothly", async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    const savedWidth = 310;
    await page.addInitScript((w) => {
      localStorage.setItem("theme", "light");
      localStorage.setItem("csa-sidebar-width", String(w));
      localStorage.setItem("sidebar-collapsed", "true");

      (window as unknown as { __sidebarCollapsedWidths: number[] }).__sidebarCollapsedWidths = [];

      function recordFrame() {
        const aside = document.querySelector("aside");
        if (aside) {
          const width = Math.round(aside.getBoundingClientRect().width);
          (window as unknown as { __sidebarCollapsedWidths: number[] }).__sidebarCollapsedWidths.push(width);
        }
        requestAnimationFrame(recordFrame);
      }
      requestAnimationFrame(recordFrame);
    }, savedWidth);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    const recordedWidths = await page.evaluate(() => {
      return (window as unknown as { __sidebarCollapsedWidths: number[] }).__sidebarCollapsedWidths;
    });

    console.log("Recorded collapsed sidebar widths on rAF:", recordedWidths);

    // 1. Assert every value is 64 and first value is 64, zero values equal 240 or 310
    expect(recordedWidths.length).toBeGreaterThan(0);
    expect(recordedWidths[0]).toBe(64);
    for (const w of recordedWidths) {
      expect(w).toBe(64);
    }
    expect(recordedWidths).not.toContain(240);
    expect(recordedWidths).not.toContain(savedWidth);

    // 2. Verify dataset.sidebar is "collapsed"
    const dataSidebar = await page.evaluate(() => document.documentElement.dataset.sidebar);
    expect(dataSidebar).toBe("collapsed");

    // 3. Zero console warnings (including hydration)
    const warnings = consoleIssues.filter((i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"));
    expect(warnings).toHaveLength(0);

    // 4. Expand after collapsed reload: click expand
    const expandBtn = page.locator('aside button[aria-label="Expand sidebar"]');
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();
    await page.waitForTimeout(250);

    const expandedBox = await page.locator("aside").boundingBox();
    expect(Math.round(expandedBox!.width)).toBe(savedWidth);

    const dataSidebarAfterExpand = await page.evaluate(() => document.documentElement.dataset.sidebar);
    expect(dataSidebarAfterExpand).toBeUndefined();

    // 5. Click collapse
    const collapseBtn = page.locator('aside button[aria-label="Collapse sidebar"]');
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await page.waitForTimeout(250);

    const collapsedBox = await page.locator("aside").boundingBox();
    expect(Math.round(collapsedBox!.width)).toBe(64);

    const dataSidebarAfterCollapse = await page.evaluate(() => document.documentElement.dataset.sidebar);
    expect(dataSidebarAfterCollapse).toBe("collapsed");
  });

  test("main content offset and horizontal document scroll at 200, 240, 360", async ({ page }) => {
    const widthsToTest = [200, 240, 360];
    for (const w of widthsToTest) {
      await page.addInitScript((width) => {
        localStorage.setItem("theme", "light");
        localStorage.setItem("csa-sidebar-width", String(width));
        localStorage.setItem("sidebar-collapsed", "false");
      }, w);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const sidebar = page.locator("aside");
      const mainContent = page.locator("div.h-screen.min-w-0.flex-1.overflow-y-auto");

      const sidebarBox = await sidebar.boundingBox();
      const mainBox = await mainContent.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(mainBox).not.toBeNull();

      // Main content's left edge is >= sidebar's right edge
      expect(mainBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 1);

      // document.documentElement.scrollWidth <= clientWidth at 1440
      const fitsViewport = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(fitsViewport).toBe(true);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`collapse state and footer fix (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
        localStorage.setItem("sidebar-collapsed", "true");
      }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const sidebar = page.locator("aside");
      const sidebarBox = await sidebar.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(Math.round(sidebarBox!.width)).toBe(64);

      // Handle is absent
      const handle = page.locator('div[role="separator"][aria-label="Resize sidebar"]');
      expect(await handle.count()).toBe(0);

      // Footer buttons: theme button and expand button
      const themeButton = page.locator('button[aria-label*="Switch to"]');
      const expandButton = page.locator('button[aria-label="Expand sidebar"]');

      await expect(themeButton).toBeVisible();
      await expect(expandButton).toBeVisible();

      const themeBox = await themeButton.boundingBox();
      const expandBox = await expandButton.boundingBox();

      expect(themeBox).not.toBeNull();
      expect(expandBox).not.toBeNull();

      // Each bounding box >= 32x32
      expect(themeBox!.width).toBeGreaterThanOrEqual(32);
      expect(themeBox!.height).toBeGreaterThanOrEqual(32);
      expect(expandBox!.width).toBeGreaterThanOrEqual(32);
      expect(expandBox!.height).toBeGreaterThanOrEqual(32);

      // Buttons do not intersect (stacked vertically)
      expect(themeBox!.y + themeBox!.height).toBeLessThanOrEqual(expandBox!.y);
    });
  }

  test("/incidents/inc-0003 at 1440 with sidebar at 360 and 200", async ({ page }) => {
    for (const w of [360, 200]) {
      const consoleIssues: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          consoleIssues.push(`${msg.type()}: ${msg.text()}`);
        }
      });
      page.on("pageerror", (err) => {
        consoleIssues.push(`pageerror: ${err.message}`);
      });

      await page.addInitScript((width) => {
        localStorage.setItem("theme", "light");
        localStorage.setItem("csa-sidebar-width", String(width));
        localStorage.setItem("sidebar-collapsed", "false");
      }, w);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/incidents/inc-0003");
      await page.waitForLoadState("networkidle");

      const noHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(noHorizontalScroll).toBe(true);

      const realErrors = consoleIssues.filter(
        (issue) => !issue.includes("Download the React DevTools") && !issue.includes("is outdated"),
      );
      expect(realErrors).toHaveLength(0);
    }
  });

  const CAPTURE_STATES: { state: "default" | "360" | "200" | "collapsed"; width?: number; collapsed: boolean }[] = [
    { state: "default", collapsed: false },
    { state: "360", width: 360, collapsed: false },
    { state: "200", width: 200, collapsed: false },
    { state: "collapsed", collapsed: true },
  ];

  for (const item of CAPTURE_STATES) {
    for (const theme of ["light", "dark"] as const) {
      test(`sidebar visual capture ${item.state} ${theme}`, async ({ page }) => {
        await page.addInitScript(
          ({ t, w, col }) => {
            localStorage.setItem("theme", t);
            localStorage.setItem("sidebar-collapsed", String(col));
            if (w) {
              localStorage.setItem("csa-sidebar-width", String(w));
            } else {
              localStorage.removeItem("csa-sidebar-width");
            }
          },
          { t: theme, w: item.width, col: item.collapsed },
        );
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/");
        await page.waitForTimeout(500);

        // Clipped to x0 y0 w420 h900
        await page.screenshot({
          path: `e2e/screenshots/sidebar-${item.state}-${theme}.png`,
          clip: { x: 0, y: 0, width: 420, height: 900 },
        });

        // Plus one full page each
        await page.screenshot({
          path: `e2e/screenshots/sidebar-${item.state}-${theme}-full.png`,
          fullPage: false,
        });
      });
    }
  }
});

