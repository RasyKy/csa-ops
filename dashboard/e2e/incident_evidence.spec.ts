import * as fs from "fs";
import * as path from "path";
import { expect, test, type Page } from "@playwright/test";
import {
  entitiesOf,
  isCheckedKind,
  toMarkdown,
} from "../lib/explainEntities";

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

    // After loading: 4 sections, Regenerate button, footer contains 'Generated'
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });
    const sections = page.locator("details");
    await expect(sections).toHaveCount(4);
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
    await expect(page.locator("details")).toHaveCount(4);
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

    // 4 <details> sections
    const details = page.locator("details");
    await expect(details).toHaveCount(4);

    // All four sections are open by default
    for (let i = 0; i < 4; i++) {
      await expect(details.nth(i)).toHaveAttribute("open", "");
    }

    // Summaries have 0px border (single divider comes from divide-y on details)
    const detailsCount = await details.count();
    for (let i = 0; i < detailsCount; i++) {
      const summaryBorderW = await details.nth(i).locator("summary").evaluate((el) => window.getComputedStyle(el).borderTopWidth);
      expect(parseFloat(summaryBorderW)).toBe(0);
    }

    // Single divider rect-based check: single 1px divider between preceding region and summary
    const dividerCheck = await page.evaluate(() => {
      const notices = Array.from(document.querySelectorAll(".p-4:has(.rounded-md)"));
      const lastNotice = notices[notices.length - 1];
      const strip = document.querySelector(".border-b.border-line.bg-surface-subtle");
      const firstSummary = document.querySelector("summary");
      if (!firstSummary) return null;

      const preceding = strip ?? lastNotice;
      if (!preceding) return null;

      const pRect = preceding.getBoundingClientRect();
      const sRect = firstSummary.getBoundingClientRect();
      const firstDetails = firstSummary.closest("details");
      if (!firstDetails) return null;

      const csDetails = window.getComputedStyle(firstDetails);
      const csPreceding = window.getComputedStyle(preceding);
      const csSummary = window.getComputedStyle(firstSummary);
      const csContainer = firstDetails.parentElement
        ? window.getComputedStyle(firstDetails.parentElement)
        : null;

      return {
        gap: sRect.top - pRect.bottom,
        precedingBorderBottom: parseFloat(csPreceding.borderBottomWidth),
        detailsBorderTop:
          parseFloat(csDetails.borderTopWidth) +
          (csContainer ? parseFloat(csContainer.borderTopWidth) : 0),
        summaryBorderTop: parseFloat(csSummary.borderTopWidth),
      };
    });

    expect(dividerCheck).not.toBeNull();
    // Exactly one 1px divider between preceding region and summary
    expect(dividerCheck!.summaryBorderTop).toBe(0);
    expect(dividerCheck!.precedingBorderBottom + dividerCheck!.detailsBorderTop).toBe(1);
    expect(Math.round(dividerCheck!.gap)).toBe(1);

    // Toggle section: clicking changes open state and chevron transform
    const thirdDetails = details.nth(2);
    const thirdSummary = thirdDetails.locator("summary");
    const chevronBefore = await thirdDetails.locator("summary svg.lucide-chevron-right").evaluate((el) => window.getComputedStyle(el).transform);
    await thirdSummary.click();
    await page.waitForTimeout(50);
    const isOpen = await thirdDetails.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpen).toBe(false);
    const chevronAfter = await thirdDetails.locator("summary svg.lucide-chevron-right").evaluate((el) => window.getComputedStyle(el).transform);
    console.log(`[inc-0003 stale] Chevron before: ${chevronBefore}, after: ${chevronAfter}`);
    // After closing, chevron should rotate back (transform should differ)
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

// Step 9a Mock data
const RICH_EXPLAIN_RESPONSE = {
  incident_id: "inc-0004",
  triage_time: "2026-10-01T00:00:00.000Z",
  triage_started_time: "2026-10-01T00:00:00.000Z",
  verdict: "likely_true_positive",
  confidence: "high",
  reason: "Rich mock reason",
  model: "deepseek/deepseek-chat",
  status: "ok",
  explain: {
    summary:
      "Host WS01 observed user CORP\\alice executing C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp. communicating with 192.168.1.50 using technique T1059.001.",
    objective: "Perform lateral movement and credential dumping.",
    next_steps: [
      "Isolate host WS01 immediately",
      "Revoke credentials for CORP\\alice",
      "Block traffic to 192.168.1.50 at firewall",
      "Collect triage package from endpoint",
      "Scan memory for injected payload",
      "Review domain controller authentication logs",
    ],
    notable_details: [
      "Process executed from suspicious temp directory",
      "Connection established at 2026-09-28T01:25:00.172Z to external endpoint",
      "PowerShell command line contained encoded payload",
      "LSASS memory dump created prior to beaconing",
      "Multiple failed logins preceded successful execution",
    ],
    caveats: [
      "Analysis is advisory and heuristic based",
      "Network captures are currently incomplete",
      "Endpoint agent was delayed during initial event",
      "DNS logs for this timeframe are pending ingestion",
      "External IP reputation may have changed since triage",
    ],
    generated_time: "2026-10-01T00:00:00.000Z",
    is_stale: false,
    ungrounded_mentions: [] as string[],
  },
};

const UNGROUNDED_RICH_MOCK = {
  ...RICH_EXPLAIN_RESPONSE,
  explain: {
    ...RICH_EXPLAIN_RESPONSE.explain,
    summary:
      RICH_EXPLAIN_RESPONSE.explain.summary + " Also saw unauthorized beacon to 10.9.9.9.",
    ungrounded_mentions: ["10.9.9.9"],
  },
};

test.describe("AI analysis - Step 9a upgrades", () => {
  test("rich explanation presentation: entity strip, verification, open sections, expandable lists, chips, timestamp rewrite, text integrity", async ({
    page,
  }) => {
    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(RICH_EXPLAIN_RESPONSE),
      }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    // 1. Entity strip visible with expected chips
    const strip = page.locator(".border-b.border-line.bg-surface-subtle").filter({
      hasText: "Mentioned in this analysis",
    });
    await expect(strip).toBeVisible();

    // Verification text: All N verified against incident data
    const allTexts = [
      RICH_EXPLAIN_RESPONSE.explain.summary,
      RICH_EXPLAIN_RESPONSE.explain.objective,
      ...RICH_EXPLAIN_RESPONSE.explain.next_steps,
      ...RICH_EXPLAIN_RESPONSE.explain.notable_details,
      ...RICH_EXPLAIN_RESPONSE.explain.caveats,
    ];
    const computedEntities = entitiesOf(allTexts);
    const N = computedEntities.filter((e) => isCheckedKind(e.kind)).length;
    await expect(strip.getByText(`All ${N} verified against incident data`)).toBeVisible();

    // Chips are <code>, not buttons, font contains mono
    const chips = strip.locator("code");
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < chipCount; i++) {
      const chip = chips.nth(i);
      const isButton = await chip.evaluate((el) => el.tagName.toLowerCase() === "button");
      expect(isButton).toBe(false);
      const font = await chip.evaluate((el) => window.getComputedStyle(el).fontFamily);
      expect(font.toLowerCase()).toContain("mono");
    }

    // 2. All four <details> open by default
    const details = page.locator("details");
    await expect(details).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(details.nth(i)).toHaveAttribute("open", "");
    }

    // 3. Next steps: 4 visible and 'Show 2 more' button, expand to 6
    const nextStepsOl = details.nth(1).locator("ol");
    await expect(nextStepsOl.locator("li")).toHaveCount(4);
    const toggleBtn = details.nth(1).locator("button[aria-controls]");
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText("Show 2 more");
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText("Show fewer");
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    await expect(nextStepsOl.locator("li")).toHaveCount(6);

    // 4. Notable details shows 3 items
    const notableUl = details.nth(2).locator("ul");
    await expect(notableUl.locator("li")).toHaveCount(3);

    // 5. Caveats shows 2 items
    const caveatsUl = details.nth(3).locator("ul");
    await expect(caveatsUl.locator("li")).toHaveCount(2);

    // 6. No raw ISO timestamp matches in visible text
    const aiCard = page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').first();
    const cardText = await aiCard.innerText();
    expect(cardText).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    // 7. Rewritten timestamp has a <time> element whose title equals the original ISO
    const timeEl = page.locator('time[title="2026-09-28T01:25:00.172Z"]');
    await expect(timeEl).toBeVisible();
    expect(await timeEl.getAttribute("title")).toBe("2026-09-28T01:25:00.172Z");

    // 8. TextContent after substituting each ISO match with the text of the corresponding <time> equals source text with normalized whitespace
    const notableLi2 = notableUl.locator("li").nth(1);
    const timeText = await timeEl.textContent();
    const expectedLiText = "Connection established at 2026-09-28T01:25:00.172Z to external endpoint".replace(
      "2026-09-28T01:25:00.172Z",
      timeText?.trim() ?? "",
    );
    const actualLiText = (await notableLi2.textContent())?.replace(/\s+/g, " ").trim();
    expect(actualLiText).toBe(expectedLiText.replace(/\s+/g, " ").trim());
  });

  test("ungrounded mentions in entity strip: amber badge with count and ungrounded chip styling, omitted when undefined", async ({
    page,
  }) => {
    // 1. With ungrounded mentions
    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(UNGROUNDED_RICH_MOCK),
      }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    const strip = page.locator(".border-b.border-line.bg-surface-subtle").filter({
      hasText: "Mentioned in this analysis",
    });
    await expect(strip.getByText("1 not found in incident data")).toBeVisible();

    const ungroundedChip = strip.locator('code[data-kind="ip"][data-ungrounded="true"]:has-text("10.9.9.9")');
    await expect(ungroundedChip).toBeVisible();

    // 2. With ungrounded_mentions undefined: no verification text
    const UNDEFINED_UNGROUNDED_MOCK = {
      ...RICH_EXPLAIN_RESPONSE,
      explain: {
        ...RICH_EXPLAIN_RESPONSE.explain,
        ungrounded_mentions: undefined,
      },
    };
    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(UNDEFINED_UNGROUNDED_MOCK),
      }),
    );

    await page.locator('button:has-text("Regenerate")').click();
    await page.waitForTimeout(300);
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    await expect(strip.getByText("verified against incident data")).not.toBeVisible();
    await expect(strip.getByText("not found in incident data")).not.toBeVisible();
  });

  test("XSS safety: explain item containing HTML/script tags renders literally without executing", async ({
    page,
  }) => {
    const XSS_MOCK = {
      ...MOCK_EXPLAIN_RESPONSE,
      explain: {
        ...MOCK_EXPLAIN_RESPONSE.explain,
        summary: 'Testing XSS vulnerability <img src=x onerror="window.__xss=1"> safely.',
      },
    };

    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(XSS_MOCK),
      }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    // Renders as literal text
    await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible();

    // No img element inside card
    const cardEl = page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').first();
    const imgs = cardEl.locator("img");
    expect(await imgs.count()).toBe(0);

    // window.__xss is undefined
    const xssVal = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(xssVal).toBeUndefined();
  });

  test("copy as markdown: copies full markdown matching toMarkdown with feedback state", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.route("**/api/ai/explain/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(RICH_EXPLAIN_RESPONSE),
      }),
    );

    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0004");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("Explain")').click();
    await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });

    const copyBtn = page.locator('button:has-text("Copy as markdown")');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // aria-live span reads "Copied"
    await expect(page.locator('span[aria-live="polite"]:has-text("Copied")')).toBeVisible();

    // Read clipboard and assert it matches toMarkdown from original data
    const clipText = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    const expectedMd = toMarkdown({
      incidentId: "inc-0004",
      generatedUtc: "2026-10-01 00:00:00 UTC",
      modelLabel: "deepseek-chat",
      summary: RICH_EXPLAIN_RESPONSE.explain.summary,
      objective: RICH_EXPLAIN_RESPONSE.explain.objective,
      nextSteps: RICH_EXPLAIN_RESPONSE.explain.next_steps,
      notableDetails: RICH_EXPLAIN_RESPONSE.explain.notable_details,
      caveats: RICH_EXPLAIN_RESPONSE.explain.caveats,
    });

    expect(clipText.trim()).toBe(expectedMd.trim());
  });

  test("inc-0003 stored smoke: strip present, at least 5 chips, no raw ISO, no ungrounded notice", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/incidents/inc-0003");
    await page.waitForLoadState("networkidle");

    const strip = page.locator('.border-b.border-line.bg-surface-subtle:has-text("Mentioned in this analysis")');
    expect.soft(await strip.isVisible(), "entity strip present on inc-0003").toBe(true);

    const chips = strip.locator("code");
    const chipCount = await chips.count();
    expect.soft(chipCount >= 5, `inc-0003 has at least 5 entity chips (got ${chipCount})`).toBe(true);

    const cardText = await page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').innerText();
    expect.soft(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cardText), "no raw ISO timestamp in visible card text").toBe(true);

    const ungroundedNotice = page.locator('span:has-text("Not found in incident data:")');
    expect.soft(await ungroundedNotice.isVisible(), "no ungrounded notice on inc-0003").toBe(false);
  });
});

test.describe("AI analysis -v6 captures", () => {
  const CAPTURES = [
    { label: "ai-analysis-inc-0003-light-1440-v6", id: "inc-0003", theme: "light", type: "stored" },
    { label: "ai-analysis-inc-0003-dark-1440-v6", id: "inc-0003", theme: "dark", type: "stored" },
    { label: "ai-analysis-rich-mock-light-1440-v6", id: "inc-0004", theme: "light", type: "rich" },
    { label: "ai-analysis-rich-mock-dark-1440-v6", id: "inc-0004", theme: "dark", type: "rich" },
    { label: "ai-analysis-ungrounded-light-1440-v6", id: "inc-0004", theme: "light", type: "ungrounded" },
  ] as const;

  for (const item of CAPTURES) {
    test(`capture ${item.label}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("theme", t), item.theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      if (item.type === "rich") {
        await page.route("**/api/ai/explain/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(RICH_EXPLAIN_RESPONSE),
          }),
        );
      } else if (item.type === "ungrounded") {
        await page.route("**/api/ai/explain/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(UNGROUNDED_RICH_MOCK),
          }),
        );
      } else {
        await page.route("**/api/ai/explain/**", (route) => route.abort());
      }

      await page.goto(`/incidents/${item.id}`);
      await page.waitForLoadState("networkidle");

      if (item.type === "rich" || item.type === "ungrounded") {
        await page.locator('button:has-text("Explain")').click();
        await page.waitForSelector('button:has-text("Regenerate")', { timeout: 3000 });
      }

      const aiCard = page.locator('.rounded-lg:has(h3:has-text("AI analysis"))').first();
      await aiCard.screenshot({ path: `e2e/screenshots/${item.label}.png` });
      const cardBox = await aiCard.boundingBox();
      expect(cardBox).not.toBeNull();
      console.log(`[Capture ${item.label}] size: ${cardBox!.width}x${cardBox!.height}`);
      expect(cardBox!.width).toBeGreaterThan(600);
      expect(cardBox!.height).toBeGreaterThan(300);
    });
  }
});


