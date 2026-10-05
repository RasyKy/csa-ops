import * as fs from "node:fs";

import { request, type FullConfig } from "@playwright/test";

import { E2E_AUTH_STATE, E2E_SESSION_SECRET } from "../playwright.config";

// Signs in once through the real login endpoint and saves the session cookie
// for every test (use.storageState in playwright.config.ts).
export default async function globalSetup(config: FullConfig) {
  const password = process.env.E2E_PASSWORD;
  if (!password) {
    throw new Error(
      "E2E_PASSWORD is not set. The dashboard requires a sign-in; set E2E_PASSWORD to any throwaway value " +
        "before running the tests, for example:  $env:E2E_PASSWORD = 'throwaway-test-password'",
    );
  }

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const api = await request.newContext({ baseURL });
  let status = 0;
  try {
    const res = await api.post("/api/auth/login", { data: { password } });
    status = res.status();
    if (res.ok()) {
      await api.storageState({ path: E2E_AUTH_STATE });
      return;
    }
  } finally {
    await api.dispose();
  }
  if (fs.existsSync(E2E_AUTH_STATE)) fs.rmSync(E2E_AUTH_STATE);

  const reason =
    status === 503
      ? "the dashboard says login is not configured (503)"
      : status === 401
        ? "the dashboard rejected the password (401)"
        : `the login request returned ${status}`;
  throw new Error(
    `Could not sign in for the e2e run: ${reason}.\n` +
      "If a dashboard dev server was already running, it was started without the test environment. " +
      "Stop it and start it with the same values the tests use (PowerShell, from the dashboard folder):\n" +
      `  $env:DASHBOARD_PASSWORD_HASH = (node scripts/hash-password.mjs $env:E2E_PASSWORD)\n` +
      `  $env:SESSION_SECRET = '${E2E_SESSION_SECRET}'\n` +
      "  npm run dev\n" +
      "or stop it and let Playwright start the servers itself.",
  );
}
