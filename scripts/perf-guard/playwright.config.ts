import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Render and request budget for the mail view's hot paths (open a message,
// search, switch folder). Runs against a production build made with
// DEV_MOCK_JMAP=true (`DEV_MOCK_JMAP=true npx next build --webpack`), served
// with the dev mock's benchmark-sized corpus. It counts React commits,
// component renders and JMAP requests per action, which are stable where
// timings are not, and fails when one goes over budget.json.
//
//   DEV_MOCK_JMAP=true npx next build --webpack
//   npm run test:perf-guard                      # check
//   PERF_GUARD_UPDATE=1 npm run test:perf-guard  # rewrite budget.json
const port = Number(process.env.PERF_GUARD_PORT || 3150);
// A server that is already running (e.g. a container built with
// DEV_MOCK_JMAP=true and started with DEV_MOCK_JMAP_BULK=1000): nothing is
// started then.
const externalBaseUrl = (process.env.PERF_GUARD_BASE_URL ?? "").replace(/\/+$/, "");
const adminDir = mkdtempSync(join(tmpdir(), "perf-guard-"));

export default defineConfig({
  testDir: ".",
  testMatch: /perf-guard\.spec\.ts$/,
  timeout: 180_000,
  // A count over budget is a result, not a flake.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"]] : "list",
  use: {
    baseURL: externalBaseUrl || `http://localhost:${port}`,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: externalBaseUrl ? undefined : {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    cwd: process.cwd(),
    timeout: 120_000,
    env: {
      DEV_MOCK_JMAP: "true",
      DEV_MOCK_JMAP_BULK: "1000",
      JMAP_SERVER_URL: `http://localhost:${port}/api/dev-jmap`,
      SESSION_SECRET: "perf-guard-session-secret-0123456789abcdef",
      ADMIN_CONFIG_DIR: join(adminDir, "config"),
      ADMIN_STATE_DIR: join(adminDir, "state"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
