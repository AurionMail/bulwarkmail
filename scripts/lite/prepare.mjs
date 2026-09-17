#!/usr/bin/env node
// Strips the server-only trees from a *disposable* checkout so `next build`
// with `output: "export"` has nothing dynamic left to trip over. It never
// rewrites a file - it only deletes - and it refuses to run unless you say
// the tree is throwaway (`CI=true`, as in GitHub Actions, or `--in-place`).
//
//   node scripts/lite/prepare.mjs --dry-run     # list what would go
//   node scripts/lite/prepare.mjs --in-place    # delete (in a git worktree!)
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LITE_PRUNE_SKIP_DIRS, LITE_REMOVED_PATHS, LITE_TEST_DIR_NAME, LITE_TEST_FILE_PATTERN, isMainModule, resolveRepoRoot,
} from "./lib.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);

export function collectTestPaths(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (LITE_PRUNE_SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        if (entry === LITE_TEST_DIR_NAME) out.push(full);
        else walk(full);
      } else if (LITE_TEST_FILE_PATTERN.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

export function planRemovals(root) {
  const fixed = LITE_REMOVED_PATHS.map((p) => join(root, ...p.split("/"))).filter((p) => existsSync(p));
  return [...fixed, ...collectTestPaths(root)];
}

export function runPrepare({ root = repoRoot, argv = process.argv.slice(2), env = process.env, log = console.log } = {}) {
  const dryRun = argv.includes("--dry-run");
  const inPlace = argv.includes("--in-place") || ["true", "1"].includes(String(env.CI).toLowerCase());
  const removals = planRemovals(root);

  if (dryRun) {
    log(`[lite] would remove ${removals.length} paths from ${root}:`);
    for (const p of removals) log(`  - ${relative(root, p)}`);
    return { removed: [], planned: removals };
  }
  if (!inPlace) {
    throw new Error(
      "[lite] refusing to delete files from a working tree. Run this in a disposable checkout " +
        "(CI=true) or pass --in-place inside a throwaway `git worktree`. Use --dry-run to preview.",
    );
  }
  for (const p of removals) rmSync(p, { recursive: true, force: true });
  log(`[lite] removed ${removals.length} server-only paths from ${root}`);
  return { removed: removals, planned: removals };
}

if (isMainModule(import.meta.url)) {
  try {
    runPrepare();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
