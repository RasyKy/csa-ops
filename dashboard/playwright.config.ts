import { randomBytes, scryptSync } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { defineConfig } from "@playwright/test";

// Test-only values. The dashboard now requires a sign-in, so the servers this
// config starts get a password hash derived from E2E_PASSWORD (which you set
// when running the tests) and a fixed session secret that exists only here.
export const E2E_SESSION_SECRET = "e2e-only-session-secret-not-for-real-use-0123456789";
export const E2E_AUTH_STATE = path.join(os.tmpdir(), "csa-ops-e2e-auth.json");

// Same scrypt parameters as scripts/hash-password.mjs.
export function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const e2ePassword = process.env.E2E_PASSWORD;
const repoRoot = path.join(__dirname, "..");
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;

// Harness for the dashboard e2e specs. Starts the dashboard dev server and a
// backend (fixtures mode, intake off) unless something is already listening
// on those ports, in which case that server is reused. A reused dashboard must
// have been started with the same DASHBOARD_PASSWORD_HASH and SESSION_SECRET
// (see e2e/global-setup.ts for the command).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    storageState: E2E_AUTH_STATE,
  },
  webServer: [
    {
      command: "python -m uvicorn backend.app.main:app --port 8000",
      cwd: repoRoot,
      url: "http://localhost:8000/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { ...env, INTAKE_ENABLED: "false" },
    },
    {
      command: "npm run dev",
      cwd: __dirname,
      url: "http://localhost:3000/login",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...env,
        SESSION_SECRET: E2E_SESSION_SECRET,
        ...(e2ePassword ? { DASHBOARD_PASSWORD_HASH: scryptHash(e2ePassword) } : {}),
      },
    },
  ],
});
