import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

import { fetchWithTimeout } from "../lib/fetchWithTimeout";

test.describe("Deploy readiness: fetchWithTimeout", () => {
  test("aborts after timeout and reports a typed failure", async () => {
    const server = http.createServer((_req, _res) => {
      // Intentionally never respond to simulate hanging backend
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const result = await fetchWithTimeout(`http://127.0.0.1:${port}`, undefined, 50);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("timeout");
      }
    } finally {
      server.close();
    }
  });
});

test.describe("Deploy readiness: static maxDuration check", () => {
  test("every route handler and server page calling backendFetch exports maxDuration = 60", () => {
    const appDir = path.join(__dirname, "../app");
    const missingMaxDuration: string[] = [];
    const edgeCallers: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.includes("backendFetch") && !fullPath.endsWith("api.ts")) {
            if (!content.includes("export const maxDuration = 60;")) {
              missingMaxDuration.push(path.relative(appDir, fullPath));
            }
            if (content.includes('runtime = "edge"') || content.includes("runtime = 'edge'")) {
              edgeCallers.push(path.relative(appDir, fullPath));
            }
          }
        }
      }
    }

    scanDir(appDir);
    expect(missingMaxDuration).toEqual([]);
    expect(edgeCallers).toEqual([]);
  });
});

test.describe("Deploy readiness: GET /api/backend-status", () => {
  test("returns exactly {ok: true} against running backend", async ({ page }) => {
    const res = await page.request.get("/api/backend-status");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });
});

test.describe("Deploy readiness: BackendWakeBanner", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`banner appears when not ok, has role=status, screenshot taken, hides when ok (${theme})`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      let statusOk = false;
      await page.route("**/api/backend-status", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: statusOk }),
        });
      });

      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const banner = page.locator('[role="status"]');
      await expect(banner).toBeVisible();

      // Ensure screenshots directory exists and save screenshot before asserting copy
      const screenshotsDir = path.join(__dirname, "screenshots");
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const screenshotPath = path.join(screenshotsDir, `backend-wake-banner-${theme}-1440x900.png`);
      await banner.screenshot({ path: screenshotPath });

      // Assert banner text
      await expect(banner).toContainText(
        "The demo backend is waking up. This can take up to a minute after it has been idle.",
      );

      // Now set status to true and wait for poll to hide banner
      statusOk = true;
      await expect(banner).not.toBeVisible({ timeout: 12000 });

      expect(consoleErrors).toEqual([]);
    });
  }

  test("banner is absent on /login", async ({ page, context }) => {
    await context.clearCookies();
    await page.route("**/api/backend-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      });
    });

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const banner = page.locator('[role="status"]');
    await expect(banner).not.toBeVisible();
  });
});

test.describe("Deploy readiness: Error handling", () => {
  test("mocked 503 backend_unavailable from proxy route does not crash Overview", async ({ page }) => {
    await page.route("**/api/backend-status", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "backend_unavailable" }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main")).toBeVisible();
  });
});
