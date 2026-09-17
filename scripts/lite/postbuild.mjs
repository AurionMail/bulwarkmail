#!/usr/bin/env node
// Writes the deployer-facing files into out/ after `next build` exported the
// shells: runtime config, policy, manifest, the root locale shim and the host
// snippets. Everything is derived from the LITE_* env the build ran with.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCaddyExample, buildHeaders, buildLiteConfig, buildLitePolicy, buildManifest, buildNginxExample, buildReadme, buildRedirects, buildRootRedirect, discoverBuiltLocales, isMainModule, normalizeBasePath, resolveRepoRoot,
} from "./lib.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);

export function runPostbuild({ root = repoRoot, env = process.env, log = console.log } = {}) {
  const outDir = join(root, "out");
  if (!existsSync(outDir)) throw new Error(`[lite] ${outDir} does not exist - run the export first`);

  const basePath = normalizeBasePath(env.NEXT_PUBLIC_BASE_PATH);
  const locales = discoverBuiltLocales(outDir);
  if (locales.length === 0) throw new Error("[lite] no locale shells found under out/ (expected out/<locale>/mail/index.html)");
  const defaultLocale = (env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "").trim() || "en";

  let version = "0.0.0";
  try {
    version = readFileSync(join(root, "VERSION"), "utf8").trim();
  } catch {
    // no VERSION file
  }
  const commit = (env.GIT_COMMIT ?? "").trim().slice(0, 7) || "local";

  const config = buildLiteConfig(env);
  const connectSrc = config.allowCustomJmapEndpoint || !config.jmapServerUrl ? "*" : new URL(config.jmapServerUrl).origin;

  const files = {
    "config.json": JSON.stringify(config, null, 2) + "\n",
    "policy.json": JSON.stringify(buildLitePolicy(), null, 2) + "\n",
    "manifest.webmanifest": JSON.stringify(buildManifest({ appName: config.appName, basePath }), null, 2) + "\n",
    "index.html": buildRootRedirect({ basePath, locales, defaultLocale }),
    "_redirects": buildRedirects({ basePath, locales }),
    "_headers": buildHeaders({ basePath, connectSrc }),
    "nginx.conf.example": buildNginxExample({ basePath }),
    "Caddyfile.example": buildCaddyExample({ basePath }),
    "LITE-README.md": buildReadme({ version, commit, basePath, locales, jmapServerUrl: config.jmapServerUrl, demoMode: config.demoMode }),
    "lite-build.json": JSON.stringify({ version, commit, basePath, locales, builtAt: new Date().toISOString() }, null, 2) + "\n",
  };

  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(outDir, name), content);
  }
  log(`[lite] wrote ${Object.keys(files).length} files into out/ (${locales.length} locales, base path ${basePath || "/"})`);
  return { outDir, locales, basePath, files: Object.keys(files) };
}

if (isMainModule(import.meta.url)) {
  try {
    runPostbuild();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
