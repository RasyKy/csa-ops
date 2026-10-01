import { defineConfig } from "@playwright/test";

// Manual visual-verification harness for the Overview redesign -- not part
// of CI or the pytest suite. Assumes the dev server (npm run dev) and the
// backend (fixtures mode) are already running on their usual ports.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
  },
});
