import { test, expect, type Page } from '@playwright/test';
import { JmapClient } from './helpers/jmap';
import { accountSwitcher, neutralizeDevOverlay } from './helpers/app';
import {
  ORG,
  ORG_PASSWORD,
  ORG_SERVER,
  adminContext,
  contextOptions,
  getPolicy,
  putPolicy,
  requireOrgEnv,
  shot,
  userPage,
} from './helpers/org';

/**
 * Shared templates (organisation feature 3), through the real UI on a VM 106
 * test server.
 *
 * On the v1.0.0 release (label 1.0.0, the only one with working metadata):
 * the admin builds a library on Organisation > Templates, for Everyone and
 * for org-two.test; org-alice adds a team template in org-team, org-bob
 * picks it; org-alice's own template reaches a second browser; org-dave
 * sees the library of his domain; the admin locks team templates for the
 * group; the picker, the manager and the admin page work at phone width.
 *
 * On 0.16 and the 1.0 test build: no team section, personal templates stay
 * in the browser as before, and the app stays online.
 *
 * The admin's policy is put back, and every template entry these tests put
 * in the accounts' Inbox metadata is removed again.
 */

test.describe.configure({ mode: 'serial', timeout: 240000 });

const METADATA = ORG_SERVER === '1.0.0';
const STAMP = Date.now().toString(36);
const LIBRARY = `Org welcome ${STAMP}`;
const SCOPE_TEMPLATE = `Two offer ${STAMP}`;
const TEAM_TEMPLATE = `Team reply ${STAMP}`;
const TEAM_BODY = `The team answers ${STAMP}`;
const PERSONAL = `Alice own ${STAMP}`;
const LOCAL = `Local only ${STAMP}`;

const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';
const META = 'urn:ietf:params:jmap:metadata';

let original: Record<string, unknown>;

/** Bulwark's template entries in the Inbox metadata of an account the user can open. */
async function templateEntries(email: string, accountName = email): Promise<Record<string, Record<string, unknown>>> {
  const client = await JmapClient.connect(email, ORG_PASSWORD);
  const accountId = accountName === email ? client.accountId : client.accountIdByName(accountName);
  const r = await client.request([
    ['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'q'],
    ['Mailbox/get', { accountId, '#ids': { resultOf: 'q', name: 'Mailbox/query', path: '/ids' }, properties: ['id', 'metadata'] }, 'g'],
  ], [CORE, MAIL, META]);
  const metadata = (r.methodResponses[1][1].list[0]?.metadata ?? {}) as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key === 'org.bulwarkmail.templates' || key.startsWith('org.bulwarkmail.template.')));
}

/** Removes Bulwark's template entries (never the shared tags or anything else) from an Inbox. */
async function clearTemplateEntries(email: string, accountName = email): Promise<void> {
  const client = await JmapClient.connect(email, ORG_PASSWORD);
  const accountId = accountName === email ? client.accountId : client.accountIdByName(accountName);
  const inbox = await client.request([['Mailbox/query', { accountId, filter: { role: 'inbox' } }, 'q']], [CORE, MAIL]);
  const inboxId = inbox.methodResponses[0][1].ids[0];
  for (const key of Object.keys(await templateEntries(email, accountName))) {
    await client.request([['Mailbox/set', { accountId, update: { [inboxId]: { [`metadata/${key}`]: null } } }, '0']], [CORE, MAIL, META]);
  }
}

async function clearAll(): Promise<void> {
  if (!METADATA) return;
  for (const email of [ORG.alice, ORG.bob, ORG.carol, ORG.dave]) await clearTemplateEntries(email);
  await clearTemplateEntries(ORG.alice, ORG.team);
}

async function startCompose(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Compose', exact: true }).first().click();
  await page.locator('[data-testid="email-composer"]').waitFor({ state: 'visible', timeout: 15000 });
}

/** Opens the template picker of the open composer. */
async function openPicker(page: Page) {
  const menu = page.getByTestId('composer-templates-menu');
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Insert template' }).or(page.getByRole('button', { name: 'Insert template' })).first().click();
  } else {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('t');
  }
  const dialog = page.getByRole('dialog', { name: 'Choose a Template' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Settings > Composing > Templates > Manage Templates. */
async function openManager(page: Page) {
  await page.goto('/settings/templates');
  const manage = page.getByRole('button', { name: 'Manage Templates' });
  if (!(await manage.isVisible().catch(() => false))) {
    // Phone: the settings list first.
    await page.getByRole('button', { name: 'Composing' }).or(page.getByRole('link', { name: 'Composing' })).first().click();
  }
  await page.getByRole('button', { name: 'Manage Templates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Email Templates' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createTemplate(dialog: ReturnType<Page['getByRole']>, name: string, body: string): Promise<void> {
  await dialog.getByRole('button', { name: 'New Template' }).click();
  await dialog.getByPlaceholder('e.g., Follow-up email').fill(name);
  await dialog.getByPlaceholder('Email body content...').fill(body);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByTestId('template-row').filter({ hasText: name })).toBeVisible({ timeout: 20000 });
}

async function expectOnline(page: Page): Promise<void> {
  await expect(page.getByText('Connection lost. Attempting to reconnect…')).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, {
    ...original,
    restrictions: {},
    organisation: {},
    scopes: [
      { id: 'org-two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: {} },
      { id: 'org-team', label: 'Org team', match: { groups: [ORG.team] }, policy: {} },
    ],
  });
  await admin.close();
  await clearAll();
});

test.afterAll(async ({ browser }) => {
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
  await clearAll();
});

test('the admin builds the library for Everyone and for org-two.test', async ({ browser }) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto('/admin/org-templates');
  await expect(page.getByRole('heading', { name: 'Organisation library' })).toBeVisible();
  // The dev server loads the policy twice (strict mode): wait for it.
  await page.waitForLoadState('networkidle');

  await page.getByTestId('org-template-add').click();
  await page.getByTestId('org-template-name').last().fill(LIBRARY);
  await page.getByTestId('org-template-subject').last().fill('Welcome');
  await page.getByTestId('org-template-body').last().fill(`<p>Welcome to <b>Example</b> ${STAMP}</p>`);
  await page.getByLabel('The text is HTML').last().check();
  await expect(page.getByTestId('org-template-preview').last().locator('b')).toHaveText('Example');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await shot(page, 'templates-admin-page');

  await page.getByRole('button', { name: 'Org two' }).click();
  await expect(page.getByTestId('org-template-inherited')).toContainText(LIBRARY);
  await page.getByTestId('org-template-add').click();
  await page.getByTestId('org-template-name').last().fill(SCOPE_TEMPLATE);
  await page.getByTestId('org-template-body').last().fill(`Our offer ${STAMP}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await shot(page, 'templates-admin-scope');

  const policy = await getPolicy(admin);
  const everyone = (policy.organisation as { templates: { library: Array<{ name: string; isHTML: boolean }> } }).templates.library;
  expect(everyone.map((t) => t.name)).toEqual([LIBRARY]);
  expect(everyone[0].isHTML).toBe(true);
  const two = (policy.scopes as Array<{ id: string; policy: { organisation?: { templates?: { library: Array<{ name: string }> } } } }>)
    .find((s) => s.id === 'org-two')!;
  expect(two.policy.organisation?.templates?.library.map((t) => t.name)).toEqual([SCOPE_TEMPLATE]);
  await admin.close();
});

test('the library is read-only for users and follows their domain', async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice);
  await startCompose(alice);
  let picker = await openPicker(alice);
  const organisation = picker.getByTestId('template-source-organisation');
  await expect(organisation).toContainText(LIBRARY);
  await expect(organisation).not.toContainText(SCOPE_TEMPLATE);
  await alice.keyboard.press('Escape');

  const manager = await openManager(alice);
  await manager.getByTestId('template-source-tab-organisation').click();
  const row = manager.getByTestId('template-row').filter({ hasText: LIBRARY });
  await expect(row.getByRole('button', { name: 'Edit Template' })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: 'New Template' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Preview' }).click();
  await expect(manager.getByTestId('template-preview').locator('b')).toHaveText('Example');
  await shot(alice, 'templates-manager-organisation');
  await expectOnline(alice);
  await alice.context().close();

  const dave = await userPage(browser, ORG.dave);
  await startCompose(dave);
  picker = await openPicker(dave);
  await expect(picker.getByTestId('template-source-organisation')).toContainText(LIBRARY);
  await expect(picker.getByTestId('template-source-organisation')).toContainText(SCOPE_TEMPLATE);
  await shot(dave, 'templates-picker-org-two');
  await dave.context().close();
});

test.describe('with metadata (v1.0.0)', () => {
  test.skip(!METADATA, 'team templates and templates in the account need Stalwart v1.0.0');

  test('org-alice adds a team template in org-team and org-bob uses it', async ({ browser }) => {
    const alice = await userPage(browser, ORG.alice);
    const manager = await openManager(alice);
    await manager.getByTestId('template-source-tab-team').click();
    await expect(manager.getByTestId('template-source-tab-team')).toContainText(ORG.team);
    await expect(manager.getByTestId('template-source-note')).toContainText(`Everyone in ${ORG.team}`);
    await createTemplate(manager, TEAM_TEMPLATE, TEAM_BODY);
    await shot(alice, 'templates-manager-team');
    await alice.context().close();

    const stored = await templateEntries(ORG.alice, ORG.team);
    const entry = Object.entries(stored).find(([, value]) => value.name === TEAM_TEMPLATE);
    expect(entry, JSON.stringify(Object.keys(stored))).toBeTruthy();
    expect(entry![1].body).toBe(TEAM_BODY);

    const bob = await userPage(browser, ORG.bob);
    await startCompose(bob);
    const picker = await openPicker(bob);
    const team = picker.getByTestId('template-source-team');
    await expect(team).toContainText(TEAM_TEMPLATE, { timeout: 20000 });
    const headings = await picker.getByRole('heading', { level: 2 }).allTextContents();
    expect(headings).toContain(ORG.team);
    expect(headings).toContain('Organisation');
    await shot(bob, 'templates-picker-team');
    await team.getByText(TEAM_TEMPLATE).click();
    await expect(picker).toBeHidden();
    await expect(bob.locator('.ProseMirror').first()).toContainText(TEAM_BODY);
    await expectOnline(bob);
    await bob.context().close();
  });

  test("org-alice's own template is in the account and reaches a second browser", async ({ browser }) => {
    const first = await userPage(browser, ORG.alice);
    const manager = await openManager(first);
    await expect(manager.getByTestId('template-storage-note')).toContainText('kept in your account', { timeout: 20000 });
    await createTemplate(manager, PERSONAL, `Hello from Alice ${STAMP}`);
    await shot(first, 'templates-manager-personal');
    await expect(async () => {
      const entries = await templateEntries(ORG.alice);
      expect(Object.values(entries).map((v) => v.name)).toContain(PERSONAL);
    }).toPass({ timeout: 30000 });
    await first.context().close();

    const second = await userPage(browser, ORG.alice);
    await startCompose(second);
    const picker = await openPicker(second);
    await expect(picker.getByTestId('template-source-personal')).toContainText(PERSONAL, { timeout: 20000 });
    await second.context().close();
  });

  test('a locked team template is read-only for the group', async ({ browser }) => {
    const admin = await adminContext(browser);
    const page = await admin.newPage();
    await page.goto('/admin/org-templates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Org team' }).click();
    await page.getByLabel('Lock').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByLabel('Lock').scrollIntoViewIfNeeded();
    await shot(page, 'templates-admin-lock');
    const policy = await getPolicy(admin);
    const team = (policy.scopes as Array<{ id: string; policy: { restrictions?: Record<string, unknown> } }>).find((s) => s.id === 'org-team')!;
    expect(team.policy.restrictions).toEqual({ teamTemplates: { locked: true } });
    await admin.close();

    const bob = await userPage(browser, ORG.bob);
    const manager = await openManager(bob);
    await manager.getByTestId('template-source-tab-team').click();
    await expect(manager.getByTestId('template-source-note')).toContainText('Set by your organisation');
    await expect(manager.getByRole('button', { name: 'New Template' })).toHaveCount(0);
    const row = manager.getByTestId('template-row').filter({ hasText: TEAM_TEMPLATE });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit Template' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await shot(bob, 'templates-manager-team-locked');
    await bob.context().close();

    // The lock leaves the template in place; members still use it.
    expect(Object.values(await templateEntries(ORG.alice, ORG.team)).map((v) => v.name)).toContain(TEAM_TEMPLATE);
  });

  test('the picker, the manager and the admin page work at phone width', async ({ browser }) => {
    const bob = await userPage(browser, ORG.bob, true);
    await startCompose(bob);
    const picker = await openPicker(bob);
    await expect(picker.getByTestId('template-source-team')).toContainText(TEAM_TEMPLATE, { timeout: 20000 });
    const box = await picker.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await shot(bob, 'templates-picker-phone');
    await picker.getByText(TEAM_TEMPLATE).click();
    await expect(bob.locator('.ProseMirror').first()).toContainText(TEAM_BODY);
    await bob.context().close();

    const alice = await userPage(browser, ORG.alice, true);
    const manager = await openManager(alice);
    const managerBox = await manager.boundingBox();
    expect(managerBox!.x + managerBox!.width).toBeLessThanOrEqual(390);
    await expect(manager.getByTestId('template-sources')).toBeVisible();
    await manager.getByTestId('template-source-tab-team').click();
    await expect(manager.getByTestId('template-row').filter({ hasText: TEAM_TEMPLATE })).toBeVisible();
    const overflow = await alice.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(alice, 'templates-manager-phone');
    await alice.context().close();

    const admin = await adminContext(browser, true);
    const page = await admin.newPage();
    await page.goto('/admin/org-templates');
    await expect(page.getByTestId('org-template-add')).toBeVisible();
    const adminOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(adminOverflow).toBeLessThanOrEqual(0);
    await shot(page, 'templates-admin-page-phone');
    await admin.close();
  });
});

test.describe('without metadata (0.16, 1.0 test build)', () => {
  test.skip(METADATA, 'this server keeps templates in the account');

  test('no team section, personal templates stay in the browser, and the app stays online', async ({ browser }) => {
    // The 1.0 test build advertises metadata and drops the connection on
    // it: count the metadata requests that went out and failed.
    const metadataRequests: string[] = [];
    const context = await browser.newContext(contextOptions());
    context.on('requestfailed', (request) => {
      if ((request.postData() ?? '').includes('"properties":["id","metadata"]')) metadataRequests.push(request.failure()?.errorText ?? 'failed');
    });
    const alice = await context.newPage();
    await neutralizeDevOverlay(alice);
    await alice.goto('/');
    await alice.fill('#username', ORG.alice);
    await alice.fill('#password', ORG_PASSWORD);
    await alice.click('button[type="submit"]');
    await accountSwitcher(alice).waitFor({ state: 'visible', timeout: 60000 });
    const manager = await openManager(alice);
    await expect(manager.getByTestId('template-source-tab-team')).toHaveCount(0);
    await expect(manager.getByTestId('template-storage-note')).toHaveCount(0);
    await createTemplate(manager, LOCAL, `Kept here ${STAMP}`);
    const stored = await alice.evaluate(() => ({
      browser: localStorage.getItem('template-storage') ?? '',
      account: localStorage.getItem('account-templates') ?? '',
    }));
    expect(stored.browser).toContain(LOCAL);
    expect(stored.account).not.toContain(LOCAL);
    await shot(alice, 'templates-manager-no-metadata');
    await alice.keyboard.press('Escape');

    await alice.goto('/');
    await startCompose(alice);
    const picker = await openPicker(alice);
    await expect(picker.getByTestId('template-source-team')).toHaveCount(0);
    await expect(picker).toContainText(LOCAL);
    // Long enough for the keep-alive ping after the metadata request failed.
    await alice.waitForTimeout(35000);
    await expectOnline(alice);
    if (ORG_SERVER === '1.0') expect(metadataRequests.length).toBeGreaterThan(0);
    else expect(metadataRequests).toEqual([]);
    await alice.context().close();
  });
});
