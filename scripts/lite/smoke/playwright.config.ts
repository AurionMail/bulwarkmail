import { defineConfig } from "@playwright/test";

// Smoke test for a finished Lite export (`npm run build:lite` with
// LITE_DEMO_MODE=true). Serves out/ with the dependency-free static server
// that applies the same SPA fallback the shipped host snippets do.
const port = Number(process.env.LITE_SMOKE_PORT || 4173);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `node scripts/lite/serve.mjs out ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    cwd: process.cwd(),
  },
});
