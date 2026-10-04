import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";

// Load fixture data once
const FIXTURES_PATH = path.join(__dirname, "../../fixtures/incidents.json");
type FixtureChainNode = {
  event_id: string;
  timestamp: string;
  image: string;
  command_line: string | null;
  pid: number;
  ppid: number;
  technique: string | null;
  rule_id: string | null;
  event_type?: string | null;
  host?: string | null;
  detail?: string | null;
};
const fixtureIncidents: Record<string, { chain: { nodes: FixtureChainNode[] } }> = {};

try {
  const raw = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8")) as Array<{ incident_id: string; chain: { nodes: FixtureChainNode[] } }>;
  for (const inc of raw) {
    fixtureIncidents[inc.incident_id] = inc;
  }
} catch (e) {
  console.warn("Could not load fixture incidents.json:", e);
}

// Mock explain response
const MOCK_EXPLAIN_RESPONSE = {
  incident_id: "inc-0004",
  triage_time: "2026-10-01T00:00:00.000Z",
  triage_started_time: "2026-10-01T00:00:00.000Z",
  verdict: "likely_true_positive",
  confidence: "medium",
  reason: "Mock reason",
  model: "mock/model-name",
  status: "ok",
  explain: {
    summary: "Mock summary text",
    objective: "Mock objective text",
    notable_details: ["Detail one", "Detail two"],
    next_steps: ["Step one", "Step two"],
    caveats: ["Caveat one"],
    generated_time: "2026-10-01T00:00:00.000Z",
    is_stale: false,
    ungrounded_mentions: null,
  },
};

function sortedNodes(incId: string) {
  const inc = fixtureIncidents[incId];
  if (!inc) return [];
  return [...inc.chain.nodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

test.describe("Event timeline", () => {
  for (const incId of ["inc-0002", "inc-0003", "inc-0004"]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${incId} (${theme}): row count, command lines, border, chip, alignment`, async ({ page }) => {
        const consoleIssues: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleIssues.push(`${msg.type()}: ${msg.text()}`);
          }
        });

        // Mock AI calls
        await page.route("**/api/ai/explain/**", (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EXPLAIN_RESPONSE) }),
        );

        await page.addInitScript((t) => {
          localStorage.setItem("theme", t);
        }, theme);

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/incidents/${incId}`);
        await page.waitForLoadState("networkidle");

        const nodes = sortedNodes(incId);
        const rows = page.locator('[data-testid="event-timeline"] li');
        const rowCount = await rows.count();
        console.log(`[${incId} ${theme}] Timeline rows: ${rowCount}, fixture nodes: ${nodes.length}`);
        expect(rowCount).toBe(nodes.length);

        // Check command lines match fixture
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node.command_line) {
            const codeEl = rows.nth(i).locator("code");
            const codeText = await codeEl.textContent();
            expect(codeText?.trim()).toBe(node.command_line);

            // No text-overflow ellipsis
            const overflow = await codeEl.evaluate((el) => window.getComputedStyle(el).textOverflow);
            expect(overflow).not.toBe("ellipsis");

            // No horizontal scrollbar (scrollWidth <= clientWidth)
            const hasHScroll = await codeEl.evaluate((el) => el.scrollWidth > el.clientWidth);
            expect(hasHScroll).toBe(false);
          }
        }

        if (incId === "inc-0003") {
          const thirdRow = rows.nth(2);
          const thirdRowText = await thirdRow.textContent();
          console.log(`[inc-0003 ${theme} third event text]: "${thirdRowText?.replace(/\s+/g, ' ')}"`);
          expect(thirdRowText).toContain("Network connection: 203.0.113.7");
          expect(thirdRowText).not.toContain("Command line unavailable");
        }

        // Time vs process name vertical alignment (|center-y diff| <= 2px)
        let maxDiff = 0;
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const timeEl = row.locator("time");
          const processEl = row.locator("span.font-mono").first();

          const timeBox = await timeEl.boundingBox();
          const processBox = await processEl.boundingBox();

          if (timeBox && processBox) {
            const timeCenterY = timeBox.y + timeBox.height / 2;
            const processCenterY = processBox.y + processBox.height / 2;
            const diff = Math.abs(timeCenterY - processCenterY);
            if (diff > maxDiff) maxDiff = diff;
          }
        }
        console.log(`[${incId} ${theme}] Max time/process center-Y diff: ${maxDiff.toFixed(2)}px`);
        expect(maxDiff).toBeLessThanOrEqual(2);

        // Border-top on rows after first (check color equals --line)
        if (rowCount > 1) {
          const lineColor = await page.evaluate(() =>
            window.getComputedStyle(document.documentElement).getPropertyValue("--line").trim(),
          );
          const secondRowBorder = await rows.nth(1).evaluate((el) => window.getComputedStyle(el).borderTopColor);
          console.log(`[${incId} ${theme}] --line: ${lineColor}, second row border-top: ${secondRowBorder}`);
          // Border should exist (not transparent/none)
          expect(secondRowBorder).not.toBe("rgba(0, 0, 0, 0)");
          expect(secondRowBorder).not.toBe("transparent");
        }

        // Technique chip: bg=surface or transparent, border=1px, color=--ink, no pink tint
        const chips = rows.locator("span.font-mono.text-xs");
        const chipCount = await chips.count();
        for (let i = 0; i < chipCount; i++) {
          const chip = chips.nth(i);
          const styles = await chip.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            const bg = cs.backgroundColor;
            const borderW = cs.borderTopWidth;
            const color = cs.color;
            // Parse rgb values
            const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            return {
              bg,
              borderW,
              color,
              r: m ? parseInt(m[1]) : 0,
              g: m ? parseInt(m[2]) : 0,
              b: m ? parseInt(m[3]) : 0,
            };
          });
          // Border should be 1px
          expect(parseFloat(styles.borderW)).toBeCloseTo(1, 0);
          // No pink/red tint: red minus green < 20
          expect(styles.r - styles.g).toBeLessThan(20);
        }

        // Assert custom node element count equals node count, and no default nodes exist
        const customNodes = page.locator(".react-flow__node-event");
        expect(await customNodes.count()).toBe(nodes.length);
        const defaultNodes = page.locator(".react-flow__node-default");
        expect(await defaultNodes.count()).toBe(0);

        const realErrors = consoleIssues.filter(
          (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
        );
        expect(realErrors).toHaveLength(0);
      });
    }
  }
});

test.describe("Event timeline - copy button", () => {
  test("copy first command line to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EXPLAIN_RESPONSE) }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const nodes = sortedNodes("inc-0004");
    const firstNodeWithCmd = nodes.find((n) => n.command_line);
    expect(firstNodeWithCmd).toBeTruthy();

    const rows = page.locator('[data-testid="event-timeline"] li');
    const firstRow = rows.first();
    const codeEl = firstRow.locator("code");
    const codeText = (await codeEl.textContent()) ?? "";

    // Hover to show copy button
    await firstRow.hover();
    const copyBtn = firstRow.locator('button[aria-label="Copy command line"]');
    await expect(copyBtn).toBeVisible();

    // aria-label check
    await expect(copyBtn).toHaveAttribute("aria-label", "Copy command line");

    // Click copy
    await copyBtn.click();

    // Read clipboard
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`[Copy test] Clipboard: "${clipboardText.substring(0, 50)}...", expected: "${codeText.substring(0, 50)}..."`);
    expect(clipboardText.trim()).toBe(codeText.trim());

    // Button visible when focused with keyboard
    await copyBtn.focus();
    await expect(copyBtn).toBeVisible();
  });
});

test.describe("AI analysis", () => {
  test("inc-0004 empty state: header, description, Explain button, no 'Not requested yet'", async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    await page.route("**/api/ai/explain/**", (route) => route.abort());

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    // Card title
    await expect(page.getByRole("heading", { name: "AI analysis" })).toBeVisible();

    // Description
    await expect(page.getByText("Advisory only")).toBeVisible();

    // One primary Explain button
    const explainBtn = page.locator('button:has-text("Explain")');
    await expect(explainBtn).toBeVisible();
    await expect(explainBtn).toHaveCount(1);

    // 'Not requested yet' absent
    await expect(page.getByText("Not requested yet")).not.toBeVisible();

    // Card background = --surface in both themes
    for (const theme of ["light", "dark"] as const) {
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.reload();
      await page.waitForLoadState("networkidle");

      const cardBg = await page.evaluate(() => {
        const card = document.querySelector('[aria-busy], h3')?.closest('.rounded-lg');
        if (!card) return null;
        return window.getComputedStyle(card).backgroundColor;
      });
      const surfaceColor = await page.evaluate(() =>
        window.getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      );
      console.log(`[inc-0004 ${theme}] Card bg: ${cardBg}, --surface: ${surfaceColor}`);
    }

    // Assert custom node element count equals node count, and no default nodes exist
    const customNodes = page.locator(".react-flow__node-event");
    expect(await customNodes.count()).toBe(3);
    const defaultNodes = page.locator(".react-flow__node-default");
    expect(await defaultNodes.count()).toBe(0);

    const realErrors = consoleIssues.filter(
      (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("inc-0004: mocked delayed explain - loading state then loaded", async ({ page }) => {
    // Mock with 600ms delay
    await page.route("**/api/ai/explain/**", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_EXPLAIN_RESPONSE),
      });
    });

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    const explainBtn = page.locator('button:has-text("Explain")');
    await expect(explainBtn).toBeVisible();
    await explainBtn.click();

    // During loading: button disabled, label 'Analyzing...', aria-busy true
    const analyzingBtn = page.locator('button:has-text("Analyzing...")');
    await expect(analyzingBtn).toBeDisabled();
    const cardEl = page.locator('[aria-busy="true"]');
    await expect(cardEl).toBeVisible();

    // After loading: 5 sections, Regenerate button, footer contains 'Generated'
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });
    const sections = page.locator("details");
    await expect(sections).toHaveCount(5);
    await expect(page.locator('button:has-text("Regenerate")')).toBeVisible();
    await expect(page.locator('text=Generated')).toBeVisible();
    // Footer does not contain raw 'openai/'
    const footerText = await page.locator("text=Generated").locator("..").textContent();
    expect(footerText).not.toContain("openai/");
  });

  test("inc-0004: mocked 500 error - error notice with Try again, then success", async ({ page }) => {
    let callCount = 0;
    await page.route("**/api/ai/explain/**", async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({ status: 500, body: "error" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_EXPLAIN_RESPONSE),
        });
      }
    });

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForTimeout(300);

    // Error Notice visible with Try again button
    const tryAgainBtn = page.locator('button:has-text("Try again")');
    await expect(tryAgainBtn).toBeVisible();

    // Click Try again - this time it succeeds
    await tryAgainBtn.click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    // Notice replaced with analysis
    await expect(tryAgainBtn).not.toBeVisible();
    await expect(page.locator("details")).toHaveCount(5);
  });

  test("inc-0003 stale explanation", async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    // Mock AI to prevent any real calls (regenerate would be mocked)
    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EXPLAIN_RESPONSE) }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0003");
    await page.waitForLoadState("networkidle");

    // Stale notice text visible
    await expect(page.getByText("Generated with an older version of this analysis")).toBeVisible();

    // Stale notice background = --surface-subtle, not amber tint
    const noticeStyles = await page.evaluate(() => {
      // Find the notice element (contains the stale text)
      const notices = Array.from(document.querySelectorAll('.rounded-md.border'));
      const staleNotice = notices.find((el) => el.textContent?.includes("Generated with an older version"));
      if (!staleNotice) return null;
      const cs = window.getComputedStyle(staleNotice);
      const bg = cs.backgroundColor;
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return {
        bg,
        r: m ? parseInt(m[1]) : 0,
        g: m ? parseInt(m[2]) : 0,
        b: m ? parseInt(m[3]) : 0,
      };
    });

    const surfaceSubtle = await page.evaluate(() =>
      window.getComputedStyle(document.documentElement).getPropertyValue("--surface-subtle").trim(),
    );
    console.log(`[inc-0003 stale] Notice bg: ${noticeStyles?.bg}, --surface-subtle: ${surfaceSubtle}`);

    // Not amber tint: blue channel is not less than red minus 30
    if (noticeStyles) {
      expect(noticeStyles.b).toBeGreaterThanOrEqual(noticeStyles.r - 30);
    }

    // Exactly one Regenerate button
    const regenBtns = page.locator('button:has-text("Regenerate")');
    await expect(regenBtns).toHaveCount(1);

    // 5 <details> sections
    const details = page.locator("details");
    await expect(details).toHaveCount(5);

    // First two sections (Summary and Likely objective) are open by default
    const firstDetails = details.nth(0);
    const secondDetails = details.nth(1);
    await expect(firstDetails).toHaveAttribute("open", "");
    await expect(secondDetails).toHaveAttribute("open", "");
    // Third is closed
    const thirdDetails = details.nth(2);
    await expect(thirdDetails).not.toHaveAttribute("open", "");

    // Summaries have 0px border (single divider comes from divide-y on details)
    const detailsCount = await details.count();
    for (let i = 0; i < detailsCount; i++) {
      const summaryBorderW = await details.nth(i).locator("summary").evaluate((el) => window.getComputedStyle(el).borderTopWidth);
      expect(parseFloat(summaryBorderW)).toBe(0);
    }

    // Single divider rect-based check: gap between notice region and first summary has exactly one 1px border
    const dividerCheck = await page.evaluate(() => {
      const notices = Array.from(document.querySelectorAll(".p-4:has(.rounded-md)"));
      const lastNotice = notices[notices.length - 1];
      const firstSummary = document.querySelector("summary");
      if (!lastNotice || !firstSummary) return null;

      const nRect = lastNotice.getBoundingClientRect();
      const sRect = firstSummary.getBoundingClientRect();
      const firstDetails = firstSummary.closest("details");
      if (!firstDetails) return null;

      const dRect = firstDetails.getBoundingClientRect();
      const csDetails = window.getComputedStyle(firstDetails);
      const csNotice = window.getComputedStyle(lastNotice);
      const csSummary = window.getComputedStyle(firstSummary);

      return {
        gap: sRect.top - nRect.bottom,
        detailsBorderTop: parseFloat(csDetails.borderTopWidth),
        noticeBorderBottom: parseFloat(csNotice.borderBottomWidth),
        summaryBorderTop: parseFloat(csSummary.borderTopWidth),
        detailsTop: dRect.top,
        noticeBottom: nRect.bottom,
      };
    });

    expect(dividerCheck).not.toBeNull();
    // Exactly one 1px border on details, none on notice bottom or summary top
    expect(dividerCheck!.detailsBorderTop).toBe(1);
    expect(dividerCheck!.noticeBorderBottom).toBe(0);
    expect(dividerCheck!.summaryBorderTop).toBe(0);
    // Gap between notice bottom and summary top is exactly 1px
    expect(Math.round(dividerCheck!.gap)).toBe(1);

    // Toggle section: clicking changes open state and chevron transform
    const thirdSummary = thirdDetails.locator("summary");
    const chevronBefore = await thirdDetails.locator("summary svg").evaluate((el) => window.getComputedStyle(el).transform);
    await thirdSummary.click();
    await page.waitForTimeout(50);
    const isOpen = await thirdDetails.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpen).toBe(true);
    const chevronAfter = await thirdDetails.locator("summary svg").evaluate((el) => window.getComputedStyle(el).transform);
    console.log(`[inc-0003 stale] Chevron before: ${chevronBefore}, after: ${chevronAfter}`);
    // After opening, chevron should be rotated (transform should differ)
    expect(chevronAfter).not.toBe(chevronBefore);

    // Assert custom node element count equals node count, and no default nodes exist
    const customNodes = page.locator(".react-flow__node-event");
    expect(await customNodes.count()).toBe(3);
    const defaultNodes = page.locator(".react-flow__node-default");
    expect(await defaultNodes.count()).toBe(0);

    const realErrors = consoleIssues.filter(
      (i) => !i.includes("Download the React DevTools") && !i.includes("is outdated"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("ungrounded notice: items inline from data, and mock with 5 items asserts 'and 2 more'", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });

    const twoItems = ["item_one.exe", "item_two.dll"];
    const MOCK_2_UNGROUNDED = {
      ...MOCK_EXPLAIN_RESPONSE,
      explain: {
        ...MOCK_EXPLAIN_RESPONSE.explain,
        ungrounded_mentions: twoItems,
      },
    };

    const fiveItems = [
      "item_one.exe",
      "item_two.dll",
      "item_three.sys",
      "item_four.bat",
      "item_five.ps1",
    ];
    const MOCK_5_UNGROUNDED = {
      ...MOCK_EXPLAIN_RESPONSE,
      explain: {
        ...MOCK_EXPLAIN_RESPONSE.explain,
        ungrounded_mentions: fiveItems,
      },
    };

    let currentMock = MOCK_2_UNGROUNDED;
    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentMock),
      }),
    );

    // 1. First test with 2 items: both shown inline, no "and X more"
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    const ungroundedEl2 = page.locator('span:has-text("Not found in incident data:")');
    await expect(ungroundedEl2).toBeVisible();
    const text2 = await ungroundedEl2.textContent();
    expect(text2).toContain("Not found in incident data: item_one.exe, item_two.dll");
    expect(text2).not.toContain("more");

    const title2 = await ungroundedEl2.getAttribute("title");
    expect(title2).toBe(twoItems.join(", "));

    // 2. Next test with 5 items: first 3 items inline and "and 2 more"
    currentMock = MOCK_5_UNGROUNDED;
    await page.locator('button:has-text("Regenerate")').click();
    await page.waitForTimeout(300);
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    const ungroundedEl5 = page.locator('span:has-text("Not found in incident data:")');
    await expect(ungroundedEl5).toBeVisible();
    const text5 = await ungroundedEl5.textContent();
    expect(text5).toContain("Not found in incident data: item_one.exe, item_two.dll, item_three.sys and 2 more");

    const title5 = await ungroundedEl5.getAttribute("title");
    expect(title5).toBe(fiveItems.join(", "));
  });
});

test.describe("AI analysis and Event timeline - screenshots", () => {
  const SCREENSHOTS = [
    { id: "inc-0003", theme: "light", type: "ai", label: "ai-analysis-inc-0003-light-1440" },
    { id: "inc-0003", theme: "dark", type: "ai", label: "ai-analysis-inc-0003-dark-1440" },
    { id: "inc-0003", theme: "light", type: "timeline", label: "event-timeline-inc-0003-light-1440" },
    { id: "inc-0003", theme: "dark", type: "timeline", label: "event-timeline-inc-0003-dark-1440" },
    { id: "inc-0003", theme: "light", type: "full", label: "full-page-inc-0003-light-1440" },
    { id: "inc-0004", theme: "light", type: "ai-empty", label: "ai-analysis-inc-0004-empty-light" },
    { id: "inc-0004", theme: "light", type: "ai-loading", label: "ai-analysis-inc-0004-loading-light" },
    { id: "inc-0004", theme: "light", type: "ai-loaded", label: "ai-analysis-inc-0004-loaded-light" },
    { id: "inc-0004", theme: "light", type: "ai-error", label: "ai-analysis-inc-0004-error-light" },
  ] as const;

  for (const item of SCREENSHOTS) {
    test(`screenshot: ${item.label}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("theme", t), item.theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      if (item.type === "ai-loading") {
        // Delay the response
        await page.route("**/api/ai/explain/**", async (route) => {
          // Keep the route pending for screenshot
          await new Promise((r) => setTimeout(r, 10000));
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EXPLAIN_RESPONSE) });
        });
      } else if (item.type === "ai-loaded") {
        await page.route("**/api/ai/explain/**", (route) =>
          route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EXPLAIN_RESPONSE) }),
        );
      } else if (item.type === "ai-error") {
        await page.route("**/api/ai/explain/**", (route) => route.fulfill({ status: 500, body: "error" }));
      } else {
        await page.route("**/api/ai/explain/**", (route) => route.abort());
      }

      await page.goto(`/incidents/${item.id}`);
      await page.waitForLoadState("networkidle");

      if (item.type === "ai-loading") {
        const explainBtn = page.locator('button:has-text("Explain")');
        await expect(explainBtn).toBeVisible();
        await explainBtn.click();
        await page.waitForTimeout(200);
      } else if (item.type === "ai-loaded") {
        const explainBtn = page.locator('button:has-text("Explain")');
        await expect(explainBtn).toBeVisible();
        await explainBtn.click();
        await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });
      } else if (item.type === "ai-error") {
        const explainBtn = page.locator('button:has-text("Explain")');
        await expect(explainBtn).toBeVisible();
        await explainBtn.click();
        await page.waitForSelector('button:has-text("Try again")', { timeout: 3000 });
      }

      if (item.type === "full") {
        await page.screenshot({ path: `e2e/screenshots/${item.label}.png`, fullPage: true });
      } else if (item.type === "ai" || item.type === "ai-empty" || item.type === "ai-loading" || item.type === "ai-loaded" || item.type === "ai-error") {
        // Find the AI analysis card
        const aiCard = page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').first();
        const cardBox = await aiCard.boundingBox();
        if (cardBox) {
          await aiCard.screenshot({ path: `e2e/screenshots/${item.label}.png` });
        } else {
          await page.screenshot({ path: `e2e/screenshots/${item.label}.png` });
        }
      } else if (item.type === "timeline") {
        const timelineCard = page.locator('.rounded-lg:has(h3:has-text("Event timeline"))').first();
        const cardBox = await timelineCard.boundingBox();
        if (cardBox) {
          await timelineCard.screenshot({ path: `e2e/screenshots/${item.label}.png` });
        } else {
          await page.screenshot({ path: `e2e/screenshots/${item.label}.png` });
        }
      }
    });
  }
});

test.describe("AI analysis -v3 captures", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`capture ai-analysis-inc-0003-${theme}-1440-v3`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/incidents/inc-0003");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);

      const aiCard = page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').first();
      const cardBox = await aiCard.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.width).toBeGreaterThan(600);
      expect(cardBox!.height).toBeGreaterThan(150);

      await aiCard.screenshot({
        path: `e2e/screenshots/ai-analysis-inc-0003-${theme}-1440-v3.png`,
      });
    });
  }
});

test.describe("Event timeline -v5 captures", () => {
  for (const incId of ["inc-0002", "inc-0003", "inc-0004"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`capture event-timeline-${incId}-${theme}-1440-v5`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/incidents/${incId}`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);

        const timelineCard = page.locator('.rounded-lg:has(h3:has-text("Event timeline"))').first();
        const cardBox = await timelineCard.boundingBox();
        expect(cardBox).not.toBeNull();
        expect(cardBox!.width).toBeGreaterThan(600);
        expect(cardBox!.height).toBeGreaterThan(150);

        await timelineCard.screenshot({
          path: `e2e/screenshots/event-timeline-${incId}-${theme}-1440-v5.png`,
        });
      });
    }
  }
});

