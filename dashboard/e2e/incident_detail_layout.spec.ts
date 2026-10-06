import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

interface IncidentExpectation {
  id: string;
  expectedTitle: string;
  verdictText?: string;
}

const INCIDENTS: IncidentExpectation[] = [
  { id: "inc-0002", expectedTitle: "Malware drop chain on WS02", verdictText: "Likely true positive" },
  { id: "inc-0003", expectedTitle: "Credential dump chain on WS01", verdictText: "True positive" },
  { id: "inc-0004", expectedTitle: "Lateral movement chain on WS04", verdictText: "Likely true positive" },
];

const THEMES: ("light" | "dark")[] = ["light", "dark"];
const WIDTHS = [1440, 1024, 390];

// Ensure screenshots directory exists
const screenshotsDir = path.join(__dirname, "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe("Incident Detail Layout and Styling", () => {
  for (const inc of INCIDENTS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        test(`${inc.id} (${theme}, ${width}px) layout, tokens, and assertions`, async ({ page }) => {
          const consoleIssues: string[] = [];
          page.on("console", (msg) => {
            const type = msg.type();
            if (type === "error" || type === "warning") {
              consoleIssues.push(`[${type}] ${msg.text()}`);
            }
          });
          page.on("pageerror", (err) => {
            consoleIssues.push(`[pageerror] ${err.message}`);
          });

          await page.addInitScript((t) => {
            localStorage.setItem("theme", t);
          }, theme);

          await page.setViewportSize({ width, height: 1000 });
          await page.goto(`http://localhost:3000/incidents/${inc.id}`);
          await page.locator("h1").waitFor({ timeout: 15000 });
          await page.waitForTimeout(500);

          // 1. Assert no console errors or warnings (including hydration mismatches)
          expect(consoleIssues, `Console errors/warnings found on ${inc.id} (${theme}, ${width}px)`).toEqual([]);

          // 2. H1 text equals incidentTitle for that incident
          const h1Text = await page.locator("h1").innerText();
          expect(h1Text).toBe(inc.expectedTitle);

          // 3. "Event timeline" is visible
          await expect(page.getByText("Event timeline", { exact: false })).toBeVisible();

          // 4. No visible text matches raw ISO string regex
          const bodyText = await page.evaluate(() => document.body.innerText);
          const rawIsoMatch = bodyText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g);
          expect(rawIsoMatch, `Found raw ISO text on ${inc.id} (${theme}, ${width}px)`).toBeNull();

          // 5. Property bar checks: contains Severity, Status, Host, User, Raised only
          // and not "AI verdict", "Alerts", "Risk score"
          const propertyBar = page.locator(".border-b.border-line").first();
          const barText = await propertyBar.innerText();
          expect(barText).toContain("Severity");
          expect(barText).toContain("Status");
          expect(barText).toContain("Host");
          expect(barText).toContain("User");
          expect(barText).toContain("Raised");
          expect(barText).not.toContain("AI verdict");
          expect(barText).not.toContain("Alerts");
          expect(barText).not.toContain("Risk score");

          // 6. Details card: contains Scenario, Alerts, Risk score, Tactics, Techniques only
          // and not Host, User, Raised
          // The Case card is now the first rail card, so Details is the second.
          const detailsCard = page.locator("main > div.grid > div:last-child > div").nth(1);
          const detailsLabels = await detailsCard.locator("dt").allInnerTexts();
          expect(detailsLabels).toContain("Scenario");
          expect(detailsLabels).toContain("Alerts");
          expect(detailsLabels).toContain("Risk score");
          expect(detailsLabels).toContain("Tactics");
          expect(detailsLabels).toContain("Techniques");
          expect(detailsLabels).not.toContain("Host");
          expect(detailsLabels).not.toContain("User");
          expect(detailsLabels).not.toContain("Raised");

          // 7. AI triage card contains the verdict badge text
          const triageCard = page.locator("main > div.grid > div:first-child > div").first();
          const triageText = await triageCard.innerText();
          if (inc.verdictText) {
            expect(triageText).toContain(inc.verdictText);
          }

          // 8. No text matches /[a-z]+_[a-z]+/ inside the Tactics row; no text on page contains "openai/"
          const tacticsRow = detailsCard.locator("dt:has-text('Tactics') + dd");
          const tacticsText = await tacticsRow.innerText();
          const underscoreMatch = tacticsText.match(/[a-z]+_[a-z]+/);
          expect(underscoreMatch, `Found underscore tactic in Tactics row: "${tacticsText}"`).toBeNull();

          expect(bodyText).not.toContain("openai/");

          // 9. Response history: (first row text left minus its card left) equals
          // (a Details label left minus the Details card left) within 1px
          const detailsLabel = detailsCard.locator("dt").first();
          const detailsCardBox = await detailsCard.boundingBox();
          const detailsLabelBox = await detailsLabel.boundingBox();
          const detailsIndent = (detailsLabelBox?.x ?? 0) - (detailsCardBox?.x ?? 0);

          // Rail order: Case, Details, Indicators, Response history.
          const responseCard = page.locator("main > div.grid > div:last-child > div").nth(3);
          const responseText = responseCard.locator("li p").first();
          const responseCardBox = await responseCard.boundingBox();
          const responseTextBox = await responseText.boundingBox();
          const responseIndent = (responseTextBox?.x ?? 0) - (responseCardBox?.x ?? 0);

          const indentDiff = Math.abs(responseIndent - detailsIndent);
          console.log(
            `[${inc.id} ${theme} ${width}px] Details label indent: ${detailsIndent}px, Response text indent: ${responseIndent}px, diff: ${indentDiff}px`
          );
          expect(indentDiff).toBeLessThanOrEqual(1);

          // 10. No element with exact text "Practice mode" on inc-0003
          if (inc.id === "inc-0003") {
            const practiceModeBadge = page.getByText("Practice mode", { exact: true });
            await expect(practiceModeBadge).toHaveCount(0);
          }

          // 11. At 1440: top of first left-column card and top of first right-rail card differ by <= 1px
          if (width === 1440) {
            const leftCard = page.locator("main > div.grid > div:first-child > div").first();
            const rightCard = page.locator("main > div.grid > div:last-child > div").first();
            const leftBox = await leftCard.boundingBox();
            const rightBox = await rightCard.boundingBox();
            const leftTop = leftBox?.y ?? 0;
            const rightTop = rightBox?.y ?? 0;
            const diff = Math.abs(leftTop - rightTop);

            console.log(
              `[${inc.id} 1440 ${theme}] Left card top: ${leftTop}px, Right card top: ${rightTop}px, diff: ${diff}px`
            );
            expect(diff).toBeLessThanOrEqual(1);
          }

          // 12. At 390: scrollWidth <= clientWidth. At 1024: log layout fitting
          const scrollInfo = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));

          if (width === 390) {
            console.log(
              `[${inc.id} 390 ${theme}] scrollWidth: ${scrollInfo.scrollWidth}, clientWidth: ${scrollInfo.clientWidth}`
            );
            expect(scrollInfo.scrollWidth).toBeLessThanOrEqual(scrollInfo.clientWidth);
          }

          if (width === 1024) {
            const layoutType = await page.evaluate(() => {
              const grid = document.querySelector("main > div.grid");
              if (!grid) return "unknown";
              const cols = window.getComputedStyle(grid).gridTemplateColumns.split(" ").length;
              return cols > 1 ? "two-column" : "single-column";
            });
            console.log(
              `[${inc.id} 1024 ${theme}] layout: ${layoutType}, scrollWidth: ${scrollInfo.scrollWidth}, clientWidth: ${scrollInfo.clientWidth}, fits: ${
                scrollInfo.scrollWidth <= scrollInfo.clientWidth
              }`
            );
            expect(scrollInfo.scrollWidth).toBeLessThanOrEqual(scrollInfo.clientWidth);
          }

          // 13. Each Card's computed background equals the resolved --surface in both themes
          const cardBgCheck = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--surface)";
            document.body.appendChild(probe);
            const surfaceColor = window.getComputedStyle(probe).backgroundColor;
            document.body.removeChild(probe);

            const cards = Array.from(document.querySelectorAll("div.border-line.bg-surface"));
            const mismatches = [];
            for (const card of cards) {
              const bg = window.getComputedStyle(card).backgroundColor;
              if (bg !== surfaceColor) {
                mismatches.push({ expected: surfaceColor, actual: bg });
              }
            }
            return { count: cards.length, mismatches, surfaceColor };
          });

          console.log(
            `[${inc.id} ${theme} ${width}px] Checked ${cardBgCheck.count} cards; surface color: ${cardBgCheck.surfaceColor}`
          );
          expect(cardBgCheck.mismatches).toEqual([]);

          // 14. Save screenshot
          const screenshotPath = path.join(
            screenshotsDir,
            `incident-detail-${inc.id}-${theme}-${width}.png`
          );
          await page.screenshot({ path: screenshotPath, fullPage: true });
        });
      }
    }
  }

  // Sticky rail tests at 1440x900 and 1366x768
  test("sticky rail computed styles at 1440x900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/incidents/inc-0003");
    await page.waitForSelector("h1");
    await page.waitForTimeout(500);

    const railStyles = await page.evaluate(() => {
      const rail = document.querySelector("main > div.grid > div:last-child");
      if (!rail) return null;
      const s = window.getComputedStyle(rail);
      return {
        position: s.position,
        top: s.top,
        maxHeight: s.maxHeight,
        overflowY: s.overflowY,
        boundingTop: rail.getBoundingClientRect().top,
      };
    });

    console.log("Rail computed styles at 1440x900:", JSON.stringify(railStyles, null, 2));
    expect(railStyles?.position).toBe("sticky");
    expect(railStyles?.top).toBe("24px");
    expect(railStyles?.maxHeight).toBe("852px"); // 900 - 48
    expect(railStyles?.overflowY).toBe("auto");
  });

  for (const theme of THEMES) {
    test(`sticky rail scrolling at 1366x768 (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);

      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto("http://localhost:3000/incidents/inc-0003");
      await page.waitForSelector("h1");
      await page.waitForTimeout(500);

      const railMetrics = await page.evaluate(() => {
        // Scroll page container so sticky rail engages
        const pageContainer = document.querySelector("div.h-screen.min-w-0.flex-1.overflow-y-auto");
        if (pageContainer) {
          pageContainer.scrollTop = 300;
        }

        const rail = document.querySelector("main > div.grid > div:last-child") as HTMLElement;
        if (rail) {
          rail.scrollTop = rail.scrollHeight;
        }

        // Rail order: Case, Details, Indicators, Response history.
        const responseCard = rail?.querySelectorAll("div.border-line.bg-surface")[3];
        const cardBottom = responseCard ? responseCard.getBoundingClientRect().bottom : 0;

        return {
          scrollHeight: rail ? rail.scrollHeight : 0,
          clientHeight: rail ? rail.clientHeight : 0,
          cardBottom,
          viewportHeight: window.innerHeight,
        };
      });

      console.log(
        `[inc-0003 ${theme} 1366x768] Rail scrollHeight: ${railMetrics.scrollHeight}px, clientHeight: ${railMetrics.clientHeight}px, Response history bottom: ${railMetrics.cardBottom}px (viewport: ${railMetrics.viewportHeight}px)`
      );

      expect(railMetrics.cardBottom).toBeLessThanOrEqual(railMetrics.viewportHeight);

      // Save screenshot for 1366
      const screenshotPath = path.join(
        screenshotsDir,
        `incident-detail-inc-0003-${theme}-1366.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
    });
  }

  // Incidents list row height assertion: 39px at 1440
  test("incidents list row height assertion at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("http://localhost:3000/incidents");
    await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length > 1, {
      timeout: 15000,
    });
    await page.waitForTimeout(500);

    const rowHeights = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return Array.from(rows).map((r) => r.getBoundingClientRect().height);
    });

    console.log(`Incidents list row heights at 1440px: ${JSON.stringify(rowHeights)}`);
    expect(rowHeights.length).toBeGreaterThan(0);
    for (const h of rowHeights) {
      expect(h).toBe(39);
    }
  });
});

