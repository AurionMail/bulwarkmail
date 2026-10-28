import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { JMAP_URL } from './helpers/config';
import { neutralizeDevOverlay, accountSwitcher, emailItem, openComposer, closeComposer } from './helpers/app';
import { JmapClient } from './helpers/jmap';
import { ORG, ORG_PASSWORD, adminContext, contextOptions, requireOrgEnv, shot } from './helpers/org';

/**
 * "No third-party traffic" (organisation feature 5, #903) through the real
 * UI. The dev server runs with NO_THIRD_PARTY_TRAFFIC=true. Every request the
 * browser makes while org-alice signs in, reads mail (from a sender whose
 * domain has a favicon), composes and opens settings, and while the admin
 * opens the Organisation pages, must go to the webmail itself or the JMAP
 * server. The server's own requests (telemetry, version check, favicons,
 * directory) are covered by lib/__tests__/no-third-party-server.test.ts; the
 * direct calls here check that the routes refuse before reaching out.
 */

test.describe.configure({ mode: 'serial' });

const SUBJECT = `Third-party check ${Date.now()}`;
let seededId: string | null = null;

const allowedHosts = () => new Set([new URL(contextOptions().baseURL).host, new URL(JMAP_URL).host]);

/** Records every http(s) request of a context, service worker included. */
function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url)) urls.push(url);
  });
  return urls;
}

function outside(urls: string[]): string[] {
  const allowed = allowedHosts();
  return [...new Set(urls.filter((url) => !allowed.has(new URL(url).host)))];
}

async function signIn(page: Page, email: string): Promise<void> {
  await neutralizeDevOverlay(page);
  await page.goto('/');
  await page.fill('#username', email);
  await page.fill('#password', ORG_PASSWORD);
  await page.click('button[type="submit"]');
  await accountSwitcher(page).waitFor({ state: 'visible', timeout: 60000 });
}

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  // The mode must come from the server's config, not from this spec.
  const admin = await adminContext(browser);
  const res = await admin.request.get('/api/admin/outgoing-hosts');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.noThirdPartyTraffic, 'start the dev server with NO_THIRD_PARTY_TRAFFIC=true').toBe(true);
  await admin.close();

  // A message from a sender whose domain has a favicon, straight into the
  // Inbox (SMTP on the test servers doesn't work).
  const alice = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
  const inbox = await alice.mailboxByRole('inbox');
  const r = await alice.request([['Email/set', {
    accountId: alice.accountId,
    create: {
      m: {
        mailboxIds: { [inbox!.id]: true },
        from: [{ name: 'GitHub', email: 'noreply@github.com' }],
        to: [{ name: 'Org Alice', email: ORG.alice }],
        subject: SUBJECT,
        receivedAt: new Date().toISOString(),
        bodyStructure: { partId: 't', type: 'text/plain' },
        bodyValues: { t: { value: 'Checking that nothing leaves for an outside host.' } },
      },
    },
  }, '0']]);
  seededId = r.methodResponses[0][1].created?.m?.id ?? null;
  expect(seededId, JSON.stringify(r.methodResponses[0][1])).toBeTruthy();
});

test.afterAll(async () => {
  if (!seededId) return;
  const alice = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
  await alice.request([['Email/set', { accountId: alice.accountId, destroy: [seededId] }, '0']]);
});

test('signing in, reading, composing and settings reach no outside host', async ({ browser }) => {
  const context = await browser.newContext(contextOptions());
  const urls = recordRequests(context);
  const page = await context.newPage();
  await signIn(page, ORG.alice);

  const row = emailItem(page, SUBJECT).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.click();
  await expect(page.locator('[data-plugin-source="email-body"]').first()).toContainText('Checking that nothing leaves', { timeout: 20000 });
  // Initials, not GitHub's favicon: the avatars never ask /api/favicon.
  await expect(page.locator('img[src*="/api/favicon"]')).toHaveCount(0);
  await shot(page, 'thirdparty-reading');

  await openComposer(page);
  await page.locator('[data-testid="composer-subject"]').fill('Not sent');
  await page.waitForTimeout(1500);
  await closeComposer(page);

  await page.goto('/settings/notifications');
  await expect(page.getByText(/Push notifications need a push relay run by your organisation/)).toBeVisible({ timeout: 20000 });
  await shot(page, 'thirdparty-push-settings');
  await page.goto('/settings/message_list');
  await expect(page.getByText(/Sender/).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Sender Favicons', { exact: true })).toHaveCount(0);

  await page.waitForTimeout(2000);
  expect(urls.length).toBeGreaterThan(10);
  expect(urls.some((url) => url.includes('/api/favicon'))).toBe(false);
  expect(outside(urls)).toEqual([]);

  // Direct calls are refused before the server reaches out.
  expect((await context.request.get('/api/favicon?domain=github.com')).status()).toBe(403);
  const translate = await context.request.post('/api/translate', {
    data: { text: 'Hallo Welt', target: 'en', source: 'de' },
    headers: { Origin: new URL(contextOptions().baseURL).origin },
  });
  expect(translate.status()).toBe(403);
  expect((await context.request.get('/api/connector/capabilities')).status()).toBe(404);
  await context.close();
});

test('the admin sees the switch from the environment and what stays reachable', async ({ browser }) => {
  const admin = await adminContext(browser);
  const urls = recordRequests(admin);
  const page = await admin.newPage();
  await page.goto('/admin/organisation');
  await expect(page.getByRole('heading', { name: 'Domains and groups' }).first()).toBeVisible();
  await page.goto('/admin/org-security');
  const section = page.locator('[data-settings-section="third-party"]');
  await expect(section.getByText('No third-party traffic', { exact: true })).toBeVisible({ timeout: 20000 });
  const toggle = page.getByTestId('third-party-switch').getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toBeDisabled();
  await expect(section.getByText('NO_THIRD_PARTY_TRAFFIC', { exact: true })).toBeVisible();
  await expect(section.getByText(/whole server, not per domain or group/)).toBeVisible();
  await expect(page.getByTestId('third-party-reachable')).toContainText(new URL(JMAP_URL).host);
  await section.getByText(/Built-in outside hosts/).click();
  await expect(page.getByTestId('third-party-builtin')).toContainText('icons.duckduckgo.com');
  await section.scrollIntoViewIfNeeded();
  await shot(page, 'thirdparty-admin-security');

  await page.goto('/admin/marketplace');
  await expect(page.getByText(/official extension directory is off/).first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(outside(urls)).toEqual([]);
  await admin.close();
});

test('the admin section and the user settings work at phone width', async ({ browser }) => {
  const admin = await adminContext(browser, true);
  const page = await admin.newPage();
  await page.goto('/admin/org-security');
  const section = page.locator('[data-settings-section="third-party"]');
  await expect(section.getByText('No third-party traffic', { exact: true })).toBeVisible({ timeout: 20000 });
  await section.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'thirdparty-admin-security-phone');
  await admin.close();

  const context = await browser.newContext(contextOptions(true));
  const urls = recordRequests(context);
  const user = await context.newPage();
  await signIn(user, ORG.alice);
  await user.goto('/settings/notifications');
  await user.getByRole('button', { name: 'Notifications' }).or(user.getByRole('link', { name: 'Notifications' })).first().click();
  await expect(user.getByText(/Push notifications need a push relay run by your organisation/)).toBeVisible({ timeout: 20000 });
  await shot(user, 'thirdparty-push-settings-phone');
  expect(outside(urls)).toEqual([]);
  await context.close();
});
