import { test, expect, type Page } from "@playwright/test";

/**
 * Drives a Lite export built with LITE_DEMO_MODE=true. Everything runs in the
 * browser against the built-in demo client, so no mail server is needed.
 *
 * What it proves:
 *   - the root shim picks a locale and the login shell hydrates,
 *   - config.json (not /api/config) configures the app,
 *   - the demo account signs in and the mail list renders,
 *   - top-level navigation between static shells works client-side,
 *   - a deep link reload keeps its URL and the shell still hydrates,
 *   - a deep link parked by the 404 shim is replayed by the surface,
 *   - no request ever targets a server endpoint on the Lite origin.
 */

async function loginAsDemo(page: Page) {
  await page.goto("/en/login/");
  const demoButton = page.getByRole("button", { name: /demo/i }).first();
  await expect(demoButton).toBeVisible({ timeout: 30_000 });
  await demoButton.click();
  await page.waitForURL(/\/en\/?(mail\/?)?(\?.*)?$/, { timeout: 30_000 });
}

test.describe("Bulwark Lite demo export", () => {
  let apiRequests: string[];

  test.beforeEach(async ({ page }) => {
    apiRequests = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.origin === new URL(page.url() || "http://localhost").origin && url.pathname.includes("/api/")) {
        apiRequests.push(url.pathname);
      }
    });
  });

  test("root shim redirects to a locale and serves config.json", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/(en|de)\/$/);
    const config = await page.request.get("/config.json");
    expect(config.ok()).toBe(true);
    const body = await config.json();
    expect(body.demoMode).toBe(true);
    expect(apiRequests).toEqual([]);
  });

  test("demo login, surface switch and deep-link reload", async ({ page }) => {
    await loginAsDemo(page);

    // Mail list rendered from the demo client.
    await expect(page.locator("body")).toContainText(/inbox/i, { timeout: 30_000 });

    // Top-level navigation to other static shells.
    await page.getByRole("link", { name: /calendar/i }).first().click();
    await page.waitForURL(/\/en\/calendar\/?/);
    await page.getByRole("link", { name: /contacts/i }).first().click();
    await page.waitForURL(/\/en\/contacts\/?/);

    // A deep link below a surface must keep its URL after a full reload and
    // still hydrate the shell (served through the SPA fallback).
    // (The calendar re-serialises its own state into the URL once applied,
    // so the view segment may change; the date must survive.)
    await page.goto("/en/calendar/week/2026-09-17");
    await expect(page.locator("body")).toContainText(/September 2026/, { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/en\/calendar\/\w+\/2026-09-17$/);

    expect(apiRequests).toEqual([]);
  });

  test("a deep link parked by the 404 shim is replayed on the surface", async ({ page }) => {
    await loginAsDemo(page);
    // What app/(main)/not-found.tsx does on a host without rewrite rules:
    // park the link, load the surface root.
    await page.evaluate(() => {
      sessionStorage.setItem("bulwark-lite:pending-path", "/en/mail/folder/inbox");
    });
    await page.goto("/en/mail/");
    await page.waitForFunction(() => window.location.pathname === "/en/mail/folder/inbox", null, { timeout: 30_000 });
    expect(await page.evaluate(() => sessionStorage.getItem("bulwark-lite:pending-path"))).toBeNull();
    expect(apiRequests).toEqual([]);
  });
});
