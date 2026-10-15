import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Counts what each hot-path action costs: React commits (render passes),
 * component renders, and JMAP requests by method. See playwright.config.ts.
 *
 * Each action runs a few times and the budget is the worst run, so one
 * unlucky interleaving does not decide the result, but a change that adds a
 * render pass or a request to every open does.
 */

type Cost = { commits: number; renders: number; requests: string[] };
type Budget = Record<string, { commits: number; renders: number; requests: number }>;

const UPDATE = process.env.PERF_GUARD_UPDATE === "1";
// Renders vary a little with timing (a response landing before or after a
// deferred write); commits and requests may not grow at all.
const RENDER_SLACK = 1.1;

async function instrument(page: Page, requests: string[]) {
  await page.addInitScript(() => {
    // Never mark read: an Email/set per open is not the cost being measured.
    try {
      const raw = localStorage.getItem("settings-storage");
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 };
      parsed.state = { ...(parsed.state ?? {}), markAsReadDelay: -1 };
      localStorage.setItem("settings-storage", JSON.stringify(parsed));
    } catch { /* checked after login */ }
    const stats = { commits: 0, renders: 0 };
    (window as unknown as { __perfGuard: typeof stats }).__perfGuard = stats;
    // Function, class, forwardRef, memo and simple-memo components.
    const COUNTED = new Set([0, 1, 11, 14, 15]);
    type Fiber = { tag: number; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
    const walk = (fiber: Fiber | null) => {
      for (let f = fiber; f; f = f.sibling) {
        const prev = f.alternate;
        // PerformedWork (1): the component's render function ran this commit.
        if (COUNTED.has(f.tag) && (prev === null || (f.flags & 1) === 1)) stats.renders++;
        // A subtree whose child list was not rebuilt bailed out entirely.
        if (f.child && (prev === null || f.child !== prev.child)) walk(f.child);
      }
    };
    const renderers = new Map<number, unknown>();
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      isDisabled: false,
      inject(renderer: unknown) { const id = renderers.size + 1; renderers.set(id, renderer); return id; },
      onCommitFiberRoot(_id: number, root: { current: Fiber }) { stats.commits++; try { walk(root.current.child); } catch { /* keep counting */ } },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      checkDCE() {},
    };
  });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/dev-jmap")) return;
    try {
      const calls = (JSON.parse(req.postData() || "{}").methodCalls || []) as [string][];
      if (calls.length) requests.push(calls.map((c) => c[0]).join("+"));
    } catch { /* not a JMAP call */ }
  });
}

const LIST = '[data-tour="email-list"]';
const VIEWER = '[data-tour="email-viewer"]';

test("hot paths stay within their render and request budget", async ({ page }, testInfo) => {
  // testDir is this directory (playwright.config.ts); works as CJS and ESM.
  const BUDGET_FILE = join(testInfo.project.testDir, "budget.json");
  const requests: string[] = [];
  await instrument(page, requests);
  await page.goto("/");
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  await page.waitForFunction((sel) => /#\d+/.test(document.querySelector(sel)?.textContent ?? ""), LIST, { timeout: 60_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("settings-storage") || "{}")?.state?.markAsReadDelay)).toBe(-1);
  await page.waitForTimeout(2000);

  const settle = () => page.waitForTimeout(700);
  const measure = async (action: () => Promise<void>): Promise<Cost> => {
    await settle();
    requests.length = 0;
    const before = await page.evaluate(() => ({ ...(window as unknown as { __perfGuard: { commits: number; renders: number } }).__perfGuard }));
    await action();
    await settle();
    const after = await page.evaluate(() => ({ ...(window as unknown as { __perfGuard: { commits: number; renders: number } }).__perfGuard }));
    return { commits: after.commits - before.commits, renders: after.renders - before.renders, requests: requests.slice() };
  };

  const open = async (index: number) => {
    const row = page.locator(`${LIST} [data-index="${index}"]`).first();
    const id = (await row.innerText()).match(/#\d+/)?.[0];
    await row.click();
    await page.waitForFunction(({ sel, id }) => {
      const v = document.querySelector(sel);
      const frame = v?.querySelector("iframe") as HTMLIFrameElement | null;
      const text = (v?.textContent ?? "") + (frame?.contentDocument?.body?.textContent ?? "");
      return !!id && text.includes(id) && /Synthetic seed message|Lorem/.test(text);
    }, { sel: VIEWER, id }, { timeout: 20_000 });
  };
  const search = async (query: string) => {
    const input = page.locator('input[type="search"]').first();
    await input.fill(query);
    await input.press("Enter");
    await page.locator('button[aria-label="Clear search"]').first().waitFor();
    await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-spin`), LIST);
  };
  const clearSearch = async () => {
    await page.locator('button[aria-label="Clear search"]').first().click();
    await page.waitForFunction((sel) => !document.querySelector('button[aria-label="Clear search"]') && !document.querySelector(`${sel} .animate-spin`), LIST);
  };
  const folder = async (name: string) => {
    await page.getByRole("button", { name, exact: false }).first().click();
    await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-spin`) && /#\d+/.test(document.querySelector(sel)?.textContent ?? ""), LIST);
  };

  const runs: Record<string, Cost[]> = { open: [], search: [], "folder (first visit)": [], "folder (revisit)": [] };
  for (const i of [1, 2, 3]) runs.open.push(await measure(() => open(i)));
  for (const q of ["incident", "review"]) {
    runs.search.push(await measure(() => search(q)));
    await clearSearch();
  }
  runs["folder (first visit)"].push(await measure(() => folder("Sent")));
  runs["folder (first visit)"].push(await measure(() => folder("Drafts")));
  runs["folder (revisit)"].push(await measure(() => folder("Inbox")));
  runs["folder (revisit)"].push(await measure(() => folder("Sent")));

  const worst: Budget = {};
  for (const [action, costs] of Object.entries(runs)) {
    worst[action] = {
      commits: Math.max(...costs.map((c) => c.commits)),
      renders: Math.max(...costs.map((c) => c.renders)),
      requests: Math.max(...costs.map((c) => c.requests.length)),
    };
    console.log(`${action}: ${JSON.stringify(worst[action])} requests=${JSON.stringify(costs.map((c) => c.requests))}`);
  }

  if (UPDATE) {
    writeFileSync(BUDGET_FILE, JSON.stringify(worst, null, 2) + "\n");
    return;
  }
  const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8")) as Budget;
  for (const [action, cost] of Object.entries(worst)) {
    const allowed = budget[action];
    expect(allowed, `no budget for "${action}"; run with PERF_GUARD_UPDATE=1`).toBeTruthy();
    expect(cost.commits, `${action}: render passes (commits)`).toBeLessThanOrEqual(allowed.commits);
    expect(cost.requests, `${action}: JMAP requests`).toBeLessThanOrEqual(allowed.requests);
    expect(cost.renders, `${action}: component renders`).toBeLessThanOrEqual(Math.ceil(allowed.renders * RENDER_SLACK));
  }
});
