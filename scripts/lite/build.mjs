#!/usr/bin/env node
// `npm run build:lite` - the whole Lite pipeline in one process so no
// cross-platform env juggling is needed:
//
//   1. prepare   delete server-only trees (disposable checkout only)
//   2. next build with NEXT_PUBLIC_BULWARK_LITE=1 (output: "export")
//   3. postbuild write config.json, manifest, host snippets into out/
//   4. verify    fail on missing files or undocumented /api references
//
// Inputs (env): LITE_JMAP_SERVER_URL, LITE_APP_NAME, LITE_ALLOW_CUSTOM_ENDPOINT,
// LITE_REMEMBER_ME, LITE_DEMO_MODE, LITE_LOCALES, NEXT_PUBLIC_BASE_PATH,
// NEXT_PUBLIC_DEFAULT_LOCALE, GIT_COMMIT. Flags: --skip-prepare (tree already
// pruned), --dry-run (print the plan only).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolveRepoRoot } from "./lib.mjs";
import { runPrepare } from "./prepare.mjs";
import { runPostbuild } from "./postbuild.mjs";
import { verifyExport } from "./verify.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

const env = {
  ...process.env,
  NEXT_PUBLIC_BULWARK_LITE: "1",
  // Without the proxy nothing rewrites /mail to /en/mail: the locale must be
  // in every URL.
  NEXT_PUBLIC_LOCALE_PREFIX: "always",
  NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
};

if (dryRun) {
  runPrepare({ argv: ["--dry-run"], env });
  console.log("[lite] would run: next build --turbopack with", {
    LITE_JMAP_SERVER_URL: env.LITE_JMAP_SERVER_URL ?? "",
    LITE_APP_NAME: env.LITE_APP_NAME ?? "",
    LITE_LOCALES: env.LITE_LOCALES ?? "(all)",
    LITE_DEMO_MODE: env.LITE_DEMO_MODE ?? "false",
    NEXT_PUBLIC_BASE_PATH: env.NEXT_PUBLIC_BASE_PATH ?? "",
  });
  process.exit(0);
}

if (!argv.includes("--skip-prepare")) {
  runPrepare({ argv: argv.filter((a) => a === "--in-place"), env });
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next", { paths: [repoRoot] });
console.log("[lite] next build --turbopack (static export)");
const build = spawnSync(process.execPath, [nextBin, "build", "--turbopack"], { cwd: repoRoot, env, stdio: "inherit" });
if (build.status !== 0) {
  console.error(`[lite] next build failed with exit code ${build.status}`);
  process.exit(build.status ?? 1);
}

runPostbuild({ env });

const { problems, locales, apiStrings } = verifyExport();
if (problems.length > 0) {
  console.error(`[lite] verification failed (${problems.length} problems):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`[lite] done: out/ holds ${locales.length} locales; ${apiStrings.length} documented /api strings in chunks`);
