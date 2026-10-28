import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { JMAP_URL } from './helpers/config';
import { neutralizeDevOverlay, accountSwitcher, emailItem, openComposer, closeComposer } from './helpers/app';
import { JmapClient } from './helpers/jmap';
import { readFileSync, existsSync } from 'node:fs';
import { ORG, ORG_PASSWORD, adminContext, contextOptions, getPolicy, putPolicy, requireOrgEnv, shot } from './helpers/org';

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
  const pushNote = page.getByText(/Push notifications need a push relay run by your organisation/);
  await expect(pushNote).toBeVisible({ timeout: 20000 });
  await pushNote.scrollIntoViewIfNeeded();
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
  const pushNote = user.getByText(/Push notifications need a push relay run by your organisation/);
  await expect(pushNote).toBeVisible({ timeout: 20000 });
  await pushNote.scrollIntoViewIfNeeded();
  await shot(user, 'thirdparty-push-settings-phone');
  expect(outside(urls)).toEqual([]);
  await context.close();
});

/**
 * A plugin that only returns image URLs (Gravatar declares no network
 * access, so it runs): its avatars must fall back to initials, and the page's
 * CSP stops anything that slips through. The zip is built from
 * repos/plugins/gravatar into the rig's scratch folder with the fallback
 * style set to "identicon"; IT_GRAVATAR_ZIP points at it.
 */
test('the Gravatar plugin runs but nothing reaches gravatar.com', async ({ browser }) => {
  const zip = process.env.IT_GRAVATAR_ZIP ?? '';
  test.skip(!zip || !existsSync(zip), 'IT_GRAVATAR_ZIP not set');
  const admin = await adminContext(browser);
  const before = await getPolicy(admin);
  const features = (before.features ?? {}) as Record<string, unknown>;
  try {
    const upload = await admin.request.post('/api/admin/plugins', {
      multipart: { file: { name: 'gravatar.zip', mimeType: 'application/zip', buffer: readFileSync(zip) } },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    await putPolicy(admin, { ...before, features: { ...features, pluginsEnabled: true }, forceEnabledPlugins: ['gravatar'] });

    const context = await browser.newContext(contextOptions());
    const urls = recordRequests(context);
    const page = await context.newPage();
    await signIn(page, ORG.alice);
    await expect(emailItem(page, SUBJECT).first()).toBeVisible({ timeout: 30000 });
    // The plugin is running in this browser. The zip's fallback style is
    // "identicon", so it returns a gravatar.com URL for every sender without
    // first asking gravatar.com whether a picture exists (a fetch the
    // sandbox's own policy stops); that URL is what the avatar must refuse.
    await page.goto('/settings/addons');
    await expect(page.getByText('Gravatar Avatars').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('On', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    // Back inside the app, so the running plugin stays loaded.
    await page.getByRole('button', { name: 'Back to Mail' }).or(page.getByRole('link', { name: 'Back to Mail' })).first().click();
    await emailItem(page, SUBJECT).first().click();
    await expect(page.locator('[data-plugin-source="email-body"]').first()).toContainText('Checking that nothing leaves', { timeout: 20000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('img[src*="gravatar.com"]')).toHaveCount(0);
    await shot(page, 'thirdparty-gravatar-initials');
    expect(urls.filter((url) => /gravatar\.com/i.test(url))).toEqual([]);
    expect(outside(urls)).toEqual([]);
    await context.close();
  } finally {
    await putPolicy(admin, before);
    await admin.request.delete('/api/admin/plugins', { data: { id: 'gravatar' } });
    await admin.close();
  }
});
