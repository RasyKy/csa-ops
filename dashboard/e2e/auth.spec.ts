import * as fs from "fs";
import * as path from "path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  COOKIE_NAME,
  clearCookie,
  isAuthConfigured,
  originAllowed,
  parseCookie,
  safeNextPath,
  sessionCookie,
  signSession,
  ttlSecondsFromEnv,
  verifySession,
} from "../lib/session";

const SECRET = "unit-test-secret-that-is-at-least-32-chars-long";
const HASH = `${"a1".repeat(16)}:${"b2".repeat(32)}`;
const NOW = Date.UTC(2026, 9, 4, 10, 0, 0);
const NONCE = "0123456789abcdef";
const SHOTS = path.join(__dirname, "screenshots");

test.describe("session tokens: unit", () => {
  test("sign and verify round trip", async () => {
    const token = await signSession(SECRET, HASH, 3600, NOW, NONCE);
    expect(token).toMatch(/^v1\.\d+\.0123456789abcdef\.[0-9a-f]{64}$/);
    expect(token.split(".")[1]).toBe(String(Math.floor(NOW / 1000) + 3600));
    expect(token.length).toBeLessThanOrEqual(256);
    expect(await verifySession(token, SECRET, HASH, NOW + 1000)).toBe(true);
  });

  test("random nonce differs between tokens and both verify", async () => {
    const a = await signSession(SECRET, HASH, 60, NOW);
    const b = await signSession(SECRET, HASH, 60, NOW);
    expect(a).not.toBe(b);
    expect(await verifySession(a, SECRET, HASH, NOW)).toBe(true);
    expect(await verifySession(b, SECRET, HASH, NOW)).toBe(true);
  });

  test("tampered payload is rejected", async () => {
    const [v, exp, nonce, sig] = (await signSession(SECRET, HASH, 3600, NOW, NONCE)).split(".");
    const later = String(Number(exp) + 100000);
    expect(await verifySession([v, later, nonce, sig].join("."), SECRET, HASH, NOW)).toBe(false);
    expect(await verifySession([v, exp, "fedcba9876543210", sig].join("."), SECRET, HASH, NOW)).toBe(false);
  });

  test("tampered signature is rejected", async () => {
    const [v, exp, nonce, sig] = (await signSession(SECRET, HASH, 3600, NOW, NONCE)).split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await verifySession([v, exp, nonce, flipped].join("."), SECRET, HASH, NOW)).toBe(false);
    expect(await verifySession([v, exp, nonce, "0".repeat(64)].join("."), SECRET, HASH, NOW)).toBe(false);
  });

  test("wrong secret is rejected", async () => {
    const token = await signSession(SECRET, HASH, 3600, NOW, NONCE);
    expect(await verifySession(token, `${SECRET}-other`, HASH, NOW)).toBe(false);
  });

  test("expired token is rejected, one second before expiry is not", async () => {
    const token = await signSession(SECRET, HASH, 60, NOW, NONCE);
    expect(await verifySession(token, SECRET, HASH, NOW + 59_000)).toBe(true);
    expect(await verifySession(token, SECRET, HASH, NOW + 60_000)).toBe(false);
    expect(await verifySession(token, SECRET, HASH, NOW + 3_600_000)).toBe(false);
  });

  test("changing the password hash invalidates existing sessions", async () => {
    const token = await signSession(SECRET, HASH, 3600, NOW, NONCE);
    const rotated = `${"c3".repeat(16)}:${"d4".repeat(32)}`;
    expect(await verifySession(token, SECRET, rotated, NOW)).toBe(false);
    expect(await verifySession(token, SECRET, HASH, NOW)).toBe(true);
  });

  test("malformed tokens never verify and never throw", async () => {
    const good = await signSession(SECRET, HASH, 3600, NOW, NONCE);
    const [, exp, nonce, sig] = good.split(".");
    const bad: (string | null | undefined)[] = [
      "",
      undefined,
      null,
      "v1",
      "v1...",
      `v2.${exp}.${nonce}.${sig}`,
      `${good}.extra`,
      `v1.${exp}.${nonce}`,
      `v1.${exp}.${nonce}.${"g".repeat(64)}`,
      `v1.${exp}.${nonce}.${sig.toUpperCase()}`,
      `v1.${exp}.${nonce}.${sig.slice(0, 62)}`,
      `v1.abc.${nonce}.${sig}`,
      `v1.${exp}.${nonce.slice(1)}.${sig}`,
      "x".repeat(300),
      `v1.${exp}.${nonce}.${"a".repeat(300)}`,
      "\u0000\u0001",
    ];
    for (const token of bad) {
      expect(await verifySession(token, SECRET, HASH, NOW), String(token).slice(0, 40)).toBe(false);
    }
    expect(await verifySession(123 as unknown as string, SECRET, HASH, NOW)).toBe(false);
  });

  test("nothing verifies when auth is not configured", async () => {
    const token = await signSession(SECRET, HASH, 3600, NOW, NONCE);
    expect(await verifySession(token, "short", HASH, NOW)).toBe(false);
    expect(await verifySession(token, SECRET, "not-a-hash", NOW)).toBe(false);
    expect(await verifySession(token, undefined, undefined, NOW)).toBe(false);
  });
});

test.describe("isAuthConfigured: unit", () => {
  test("requires a 32 character secret and a well formed hash", () => {
    expect(isAuthConfigured(SECRET, HASH)).toBe(true);
    expect(isAuthConfigured("x".repeat(32), HASH)).toBe(true);
    expect(isAuthConfigured("x".repeat(31), HASH)).toBe(false);
    expect(isAuthConfigured("", HASH)).toBe(false);
    expect(isAuthConfigured(undefined, HASH)).toBe(false);
    expect(isAuthConfigured(SECRET, undefined)).toBe(false);
    expect(isAuthConfigured(SECRET, "")).toBe(false);
    expect(isAuthConfigured(SECRET, "plaintext-password")).toBe(false);
    expect(isAuthConfigured(SECRET, `${"a".repeat(31)}:${"b".repeat(64)}`)).toBe(false);
    expect(isAuthConfigured(SECRET, `${"a".repeat(32)}:${"b".repeat(63)}`)).toBe(false);
    expect(isAuthConfigured(SECRET, `${"A".repeat(32)}:${"b".repeat(64)}`)).toBe(false);
    expect(isAuthConfigured(SECRET, `${"a".repeat(32)}:${"b".repeat(64)}\n`)).toBe(false);
    expect(isAuthConfigured(SECRET, `${"a".repeat(32)}:${"g".repeat(64)}`)).toBe(false);
  });
});

test.describe("safeNextPath: unit", () => {
  const table: [unknown, string][] = [
    ["/incidents?x=1", "/incidents?x=1"],
    ["/incidents/inc-0003", "/incidents/inc-0003"],
    ["/", "/"],
    ["/alerts#top", "/alerts#top"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/login", "/"],
    ["/login?next=/x", "/"],
    ["/api/metrics", "/"],
    ["/api", "/"],
    ["", "/"],
    [undefined, "/"],
    [null, "/"],
    [42, "/"],
    ["incidents", "/"],
    ["/ok\nSet-Cookie: x=1", "/"],
    ["/ok\u0000", "/"],
    ["/" + "a".repeat(600), "/"],
    ["/" + "a".repeat(511), "/" + "a".repeat(511)],
    ["/loginx", "/loginx"],
  ];
  for (const [input, expected] of table) {
    test(`${JSON.stringify(input)?.slice(0, 40)} -> ${expected.slice(0, 20)}`, () => {
      expect(safeNextPath(input)).toBe(expected);
    });
  }
});

test.describe("cookie helpers: unit", () => {
  test("session cookie flags", () => {
    const dev = sessionCookie("tok", 28800, false);
    expect(dev).toBe("csa_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800");
    expect(dev).not.toContain("Secure");
    const prod = sessionCookie("tok", 28800, true);
    expect(prod).toContain("; Secure");
    expect(prod).toContain("HttpOnly");
    expect(prod).toContain("SameSite=Lax");
    expect(prod).toContain("Path=/");
    expect(prod).toContain("Max-Age=28800");
  });

  test("clear cookie expires immediately", () => {
    expect(clearCookie(false)).toBe("csa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    expect(clearCookie(true)).toContain("; Secure");
    expect(clearCookie(true)).toContain("Max-Age=0");
  });

  test("parseCookie finds the named cookie", () => {
    expect(parseCookie("a=1; csa_session=abc.def; b=2", COOKIE_NAME)).toBe("abc.def");
    expect(parseCookie("csa_session_other=1", COOKIE_NAME)).toBeNull();
    expect(parseCookie("", COOKIE_NAME)).toBeNull();
    expect(parseCookie(null, COOKIE_NAME)).toBeNull();
  });

  test("originAllowed and ttl defaults", () => {
    expect(originAllowed(null, "localhost:3000")).toBe(true);
    expect(originAllowed("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(originAllowed("https://evil.example", "localhost:3000")).toBe(false);
    expect(originAllowed("null", "localhost:3000")).toBe(false);
    expect(originAllowed("http://localhost:3000", null)).toBe(false);
    expect(ttlSecondsFromEnv(undefined)).toBe(28800);
    expect(ttlSecondsFromEnv("")).toBe(28800);
    expect(ttlSecondsFromEnv("2")).toBe(7200);
    expect(ttlSecondsFromEnv("0")).toBe(28800);
    expect(ttlSecondsFromEnv("abc")).toBe(28800);
  });
});

// ---------------------------------------------------------------------------
// Against the running dashboard, with no session to start from.

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const EMPTY_STATE = { cookies: [], origins: [] };
let ipCounter = 0;

// A made-up forwarded address per use, so the throttle (keyed by it) never
// touches the address the test runner's own login used.
function fakeIp(): string {
  ipCounter += 1;
  const n = (Date.now() + ipCounter * 7919) % 250;
  return `198.51.100.${n + 1}, 10.0.${ipCounter % 250}.1`;
}

function login(request: APIRequestContext, password: string, headers: Record<string, string> = {}) {
  return request.post("/api/auth/login", {
    data: { password },
    headers: { "x-forwarded-for": fakeIp(), ...headers },
  });
}

function trackIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  return issues;
}

async function useOwnAddress(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
}

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test.describe("sign in: server behavior", () => {
  test.use({ storageState: EMPTY_STATE });

  test("pages redirect to /login with a next parameter", async ({ page }) => {
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/");

    await page.goto("/incidents/inc-0003");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/incidents/inc-0003");

    await page.goto("/incidents?severity=high");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/incidents?severity=high");
  });

  test("API calls without a session get 401 JSON", async ({ request }) => {
    for (const url of ["/api/metrics/summary?range=all", "/api/incidents", "/api/alerts"]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  test("a wrong password is a generic 401 that takes a moment", async ({ request }) => {
    const started = Date.now();
    const res = await login(request, "definitely-not-the-password");
    const elapsed = Date.now() - started;
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Incorrect password." });
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(elapsed).toBeGreaterThanOrEqual(350);
  });

  test("bad bodies are 400", async ({ request }) => {
    const headers = { "x-forwarded-for": fakeIp() };
    expect((await request.post("/api/auth/login", { data: "not json", headers })).status()).toBe(400);
    expect((await request.post("/api/auth/login", { data: { password: 5 }, headers })).status()).toBe(400);
    expect((await request.post("/api/auth/login", { data: { password: "" }, headers })).status()).toBe(400);
    expect((await request.post("/api/auth/login", { data: { password: "x".repeat(201) }, headers })).status()).toBe(400);
    expect((await request.post("/api/auth/login", { data: { password: "x".repeat(2000) }, headers })).status()).toBe(400);
  });

  test("six wrong attempts from one address are throttled with Retry-After", async ({ request }) => {
    const headers = { "x-forwarded-for": `192.0.2.${(Date.now() % 200) + 1}` };
    for (let i = 1; i <= 5; i++) {
      const res = await request.post("/api/auth/login", { data: { password: `wrong-${i}` }, headers });
      expect(res.status(), `attempt ${i}`).toBe(401);
    }
    const sixth = await request.post("/api/auth/login", { data: { password: "wrong-6" }, headers });
    expect(sixth.status()).toBe(429);
    expect(await sixth.json()).toEqual({ error: "Too many attempts." });
    const retry = Number(sixth.headers()["retry-after"]);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(300);

    // Even the right password is refused while the address is blocked...
    const blocked = await request.post("/api/auth/login", { data: { password: PASSWORD }, headers });
    expect(blocked.status()).toBe(429);
    // ...and another address is unaffected.
    expect((await login(request, PASSWORD)).status()).toBe(200);
  });

  test("the right password sets an HttpOnly session cookie and opens the Overview", async ({ page }) => {
    await useOwnAddress(page);
    const res = await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers()["set-cookie"];
    expect(setCookie).toContain(`${COOKIE_NAME}=v1.`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain("Secure");

    const issues = trackIssues(page);
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => document.cookie)).not.toContain("csa_session");
    expect(issues).toEqual([]);
  });

  test("a signed-in visit to /login goes to next or the Overview", async ({ page }) => {
    await useOwnAddress(page);
    await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
    await page.goto("/login");
    expect(new URL(page.url()).pathname).toBe("/");
    await page.goto("/login?next=%2Fincidents");
    expect(new URL(page.url()).pathname).toBe("/incidents");
    await page.goto("/login?next=%2F%2Fevil.com");
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).host).toBe("localhost:3000");
  });

  test("a tampered cookie is treated as signed out", async ({ page, context }) => {
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: `v1.9999999999.0123456789abcdef.${"0".repeat(64)}`,
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/login");
    const res = await page.request.get("/api/metrics/summary?range=all");
    expect(res.status()).toBe(401);
  });

  test("login from another origin is refused", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { password: PASSWORD },
      headers: { origin: "https://evil.example", "x-forwarded-for": fakeIp() },
    });
    expect(res.status()).toBe(403);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    const logout = await request.post("/api/auth/logout", { headers: { origin: "https://evil.example" } });
    expect(logout.status()).toBe(403);
  });

  test("mutating calls: mismatched Origin is 403, matching Origin passes the middleware", async ({ request }) => {
    expect((await login(request, PASSWORD)).status()).toBe(200);
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const res = await request[method]("/api/incidents", { headers: { origin: "https://evil.example" } });
      expect(res.status(), method).toBe(403);
    }
    // /api/incidents only exports GET, so a request that gets past the
    // middleware ends in 405 from the route layer, never 401 or 403.
    const ok = await request.post("/api/incidents", { headers: { origin: "http://localhost:3000" } });
    expect(ok.status()).toBe(405);
    const noOrigin = await request.post("/api/incidents");
    expect(noOrigin.status()).toBe(405);
  });

  test("sign out clears the session and the API closes again", async ({ page }) => {
    await useOwnAddress(page);
    await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
    await page.goto("/");
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get("/api/metrics/summary?range=all")).status()).toBe(200);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === COOKIE_NAME)).toBeUndefined();
    expect((await page.request.get("/api/metrics/summary?range=all")).status()).toBe(401);
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("security headers on /login, a signed-in page and an API response", async ({ page }) => {
    const check = (headers: Record<string, string>, label: string) => {
      expect(headers["x-content-type-options"], label).toBe("nosniff");
      expect(headers["x-frame-options"], label).toBe("DENY");
      expect(headers["referrer-policy"], label).toBe("same-origin");
    };
    const loginRes = await page.goto("/login");
    check(loginRes!.headers(), "/login");

    await useOwnAddress(page);
    await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
    const home = await page.goto("/");
    check(home!.headers(), "/");
    const api = await page.request.get("/api/metrics/summary?range=all");
    check(api.headers(), "/api/metrics/summary");
    expect(api.headers()["cache-control"]).toBe("private, no-store");
  });
});

test.describe("sign in: login page", () => {
  test.use({ storageState: EMPTY_STATE });

  test("wrong password shows an alert, re-enables the button and keeps the field", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Incorrect password." });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("not-the-password");
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("the button is disabled and relabeled while signing in", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    const button = page.getByRole("button", { name: /^Sign(ing)? in(\.\.\.)?$/ });
    await button.click();
    await expect(page.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect password." })).toBeVisible({ timeout: 10_000 });
  });

  test("show and hide toggle flips aria-pressed and the input type", async ({ page }) => {
    await page.goto("/login");
    const input = page.getByLabel("Password", { exact: true });
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(input).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(input).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("the field has the expected attributes and starts focused", async ({ page }) => {
    await page.goto("/login");
    const input = page.getByLabel("Password", { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("autocomplete", "current-password");
    await expect(input).toHaveAttribute("name", "password");
    await expect(page.getByText("Demo environment. All data is synthetic.")).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);
  });

  test("Enter submits and signs in", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("aside")).toHaveCount(1);
  });

  test("next=/incidents lands on /incidents", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/login?next=%2Fincidents");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/incidents", { timeout: 15_000 });
  });

  test("a protected page sends you back to where you were headed", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/incidents/inc-0003");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/incidents/inc-0003", { timeout: 15_000 });
  });

  for (const next of ["%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2F%5Cevil.com", "javascript%3Aalert(1)"]) {
    test(`open redirect attempt next=${next} lands on /`, async ({ page }) => {
      await useOwnAddress(page);
      await page.goto(`/login?next=${next}`);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.host === "localhost:3000" && url.pathname === "/", { timeout: 15_000 });
      expect(new URL(page.url()).host).toBe("localhost:3000");
    });
  }
});

test.describe("sign in: layout and screenshots", () => {
  test.use({ storageState: EMPTY_STATE });

  const cases: { theme: "light" | "dark"; width: number; height: number }[] = [
    { theme: "light", width: 1440, height: 900 },
    { theme: "dark", width: 1440, height: 900 },
    { theme: "light", width: 390, height: 844 },
    { theme: "dark", width: 390, height: 844 },
  ];

  for (const c of cases) {
    test(`login page ${c.theme} ${c.width}px: centered, no horizontal scroll, no console issues`, async ({ page }) => {
      const issues = trackIssues(page);
      await page.addInitScript((t) => localStorage.setItem("theme", t), c.theme);
      await page.setViewportSize({ width: c.width, height: c.height });
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await page.waitForLoadState("networkidle");

      fs.mkdirSync(SHOTS, { recursive: true });
      const file = path.join(SHOTS, `login-default-${c.theme}-${c.width}.png`);
      await page.screenshot({ path: file });
      const size = pngSize(file);
      console.log(`${path.basename(file)} ${size.width}x${size.height}`);

      const geometry = await page.evaluate(() => {
        const card = document.querySelector("main > div") as HTMLElement;
        const box = card.getBoundingClientRect();
        const scroller = document.querySelector("body > div > div") as HTMLElement;
        return {
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
          left: box.left,
          right: window.innerWidth - box.right,
          top: box.top,
          bottom: window.innerHeight - box.bottom,
          width: box.width,
          dark: document.documentElement.classList.contains("dark"),
          bg: getComputedStyle(card).backgroundColor,
        };
      });
      expect(geometry.dark).toBe(c.theme === "dark");
      expect(geometry.docOverflow).toBeLessThanOrEqual(0);
      expect(geometry.scrollerOverflow).toBeLessThanOrEqual(0);
      expect(geometry.width).toBeLessThanOrEqual(384 + 1);
      expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.top - geometry.bottom)).toBeLessThanOrEqual(2);
      expect(geometry.left).toBeGreaterThanOrEqual(15);
      expect(size.width).toBe(c.width);
      expect(size.height).toBe(c.height);
      expect(issues).toEqual([]);
    });
  }

  test("error state screenshot (light)", async ({ page }) => {
    await useOwnAddress(page);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill("wrong-for-screenshot");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect password." })).toBeVisible({ timeout: 10_000 });
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, "login-error-light-1440.png");
    await page.screenshot({ path: file });
    const size = pngSize(file);
    console.log(`${path.basename(file)} ${size.width}x${size.height}`);
    expect(size).toEqual({ width: 1440, height: 900 });
  });

  test("the sidebar sign out button is present, labeled and keyboard reachable once signed in", async ({ page }) => {
    await useOwnAddress(page);
    await page.request.post("/api/auth/login", { data: { password: PASSWORD } });
    // The sidebar shows Sign out as a labeled row when expanded and as an icon with a
    // tooltip when collapsed; the tooltip is what this test checks, so it runs collapsed.
    await page.addInitScript(() => localStorage.setItem("sidebar-collapsed", "true"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // the sidebar renders expanded first and collapses after hydration: wait for that
    await expect(page.locator('aside button[aria-label="Expand sidebar"]')).toBeVisible();
    const button = page.locator("aside").getByRole("button", { name: "Sign out" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(28);
    expect(box!.height).toBeGreaterThanOrEqual(28);
    await button.focus();
    await expect(page.getByRole("tooltip")).toHaveText("Sign out");
  });
});
