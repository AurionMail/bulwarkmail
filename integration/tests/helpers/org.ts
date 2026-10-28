/**
 * Helpers for the organisation feature specs (19-org-*.spec.ts). They run
 * against a local dev server on a VM 106 test Stalwart with the throwaway
 * org-* accounts, never the suite's alice/bob/carol, and never reset an
 * account.
 *
 * Env:
 *   IT_WEBMAIL_URL     the dev server (scratch ADMIN_CONFIG_DIR)
 *   IT_ORG_PASSWORD    password of the org-* accounts (vault "Stalwart test – org-* throwaway accounts")
 *   IT_ADMIN_PASSWORD  the dev server's admin password (vault "Bulwark dev rig – org features admin")
 *   IT_ORG_SERVER      label for screenshots and logs: 0.16, 1.0, 1.0.0
 */
import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { WEBMAIL_URL } from './config';
import { accountSwitcher, neutralizeDevOverlay } from './app';

export const ORG_PASSWORD = process.env.IT_ORG_PASSWORD ?? '';
export const ADMIN_PASSWORD = process.env.IT_ADMIN_PASSWORD ?? '';
export const ORG_SERVER = process.env.IT_ORG_SERVER ?? 'unknown';

export const ORG = {
  alice: 'org-alice@example.org',
  bob: 'org-bob@example.org',
  carol: 'org-carol@example.org',
  dave: 'org-dave@org-two.test',
  team: 'org-team@example.org',
} as const;

export function requireOrgEnv(): void {
  if (!ORG_PASSWORD || !ADMIN_PASSWORD) {
    throw new Error('Set IT_ORG_PASSWORD and IT_ADMIN_PASSWORD (vw exec --env ...) to run the org specs');
  }
}

/** English UI (Playwright's default locale gives German) at desktop or phone width. */
export function contextOptions(phone = false) {
  return {
    baseURL: WEBMAIL_URL,
    locale: 'en-US',
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
  };
}

const stateDir = path.join(process.cwd(), 'integration', 'test-results');
const adminStatePath = () => path.join(stateDir, `org-admin-${new URL(WEBMAIL_URL).port || '80'}.json`);

/**
 * A browser context signed in to /admin. Admin login is rate limited (5 per
 * 15 minutes), so the session is stored once and reused across specs.
 */
export async function adminContext(browser: Browser, phone = false): Promise<BrowserContext> {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  if (existsSync(adminStatePath())) {
    const context = await browser.newContext({ ...contextOptions(phone), storageState: adminStatePath() });
    const res = await context.request.get('/api/admin/auth');
    if (res.ok() && (await res.json().catch(() => ({})))?.authenticated !== false) return context;
    await context.close();
  }
  const context = await browser.newContext(contextOptions(phone));
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.endsWith('/admin/login'), { timeout: 30000 });
  await context.storageState({ path: adminStatePath() });
  await page.close();
  return context;
}

/** The policy as the admin sees it. */
export async function getPolicy(admin: BrowserContext): Promise<Record<string, unknown>> {
  const res = await admin.request.get('/api/admin/policy');
  expect(res.ok()).toBe(true);
  return res.json();
}

export async function putPolicy(admin: BrowserContext, policy: Record<string, unknown>): Promise<void> {
  const res = await admin.request.put('/api/admin/policy', { data: policy });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Sign in a fresh context as one of the org-* accounts. */
export async function userPage(browser: Browser, email: string, phone = false): Promise<Page> {
  const context = await browser.newContext(contextOptions(phone));
  const page = await context.newPage();
  await neutralizeDevOverlay(page);
  await page.goto('/');
  await page.fill('#username', email);
  await page.fill('#password', ORG_PASSWORD);
  await page.click('button[type="submit"]');
  await accountSwitcher(page).waitFor({ state: 'visible', timeout: 60000 });
  return page;
}

/** Screenshots for local-data/org-features-screenshots/, named by feature and server. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.IT_ORG_SCREENSHOTS;
  if (!dir) return;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${ORG_SERVER}.png`), fullPage: false });
}
