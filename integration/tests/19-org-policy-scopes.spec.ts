import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ORG,
  adminContext,
  getPolicy,
  putPolicy,
  requireOrgEnv,
  shot,
  userPage,
} from './helpers/org';

/**
 * Domain and group scopes (organisation feature 8), through the real UI on a
 * VM 106 test server: the admin creates a domain scope and a group scope on
 * Organisation > Domains and groups, and each applies only where it should.
 * The admin's policy is put back afterwards.
 */

test.describe.configure({ mode: 'serial' });

let original: Record<string, unknown>;

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, { ...original, scopes: [], restrictions: {}, features: {} });
  await admin.close();
});

test.afterAll(async ({ browser }) => {
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
});

test('the admin adds a domain and a group on the Domains and groups page', async ({ browser }) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto('/admin/organisation');
  await expect(page.getByRole('heading', { name: 'Domains and groups' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add domains' }).click();
  await page.getByLabel('Name', { exact: true }).last().fill('Org two');
  await page.getByLabel('Domains', { exact: true }).last().fill('org-two.test');
  await page.getByLabel('Domains', { exact: true }).last().blur();

  await page.getByRole('button', { name: 'Add groups' }).click();
  await page.getByLabel('Name', { exact: true }).last().fill('Org team');
  await page.getByLabel('Groups', { exact: true }).last().fill(ORG.team);
  await page.getByLabel('Groups', { exact: true }).last().blur();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await shot(page, 'admin-domains-and-groups');

  const policy = await getPolicy(admin);
  const scopes = policy.scopes as Array<{ id: string; label: string; match: Record<string, string[]> }>;
  expect(scopes.map((s) => [s.label, s.match])).toEqual([
    ['Org two', { domains: ['org-two.test'] }],
    ['Org team', { groups: [ORG.team] }],
  ]);

  // The settings of each scope come with the Organisation pages of the
  // features; here they are set through the same policy the pages write.
  const [two, team] = scopes;
  await putPolicy(admin, {
    ...policy,
    scopes: [
      { ...two, policy: { features: { calendarEnabled: false } } },
      { ...team, policy: { restrictions: { density: { locked: true, value: 'compact' } } } },
    ],
  });

  // The effective policy for org-alice names the group scope.
  await page.reload();
  await page.getByLabel('User address').fill(ORG.alice);
  await page.getByLabel('Groups the user is a member of').fill(ORG.team);
  const effective = page.getByTestId('org-effective-policy');
  await expect(effective).toContainText('Applies, in this order: Everyone, Org team.');
  await expect(effective).toContainText('restrictions.density');
  await shot(page, 'admin-effective-policy');
  await admin.close();
});

test('a domain scope applies to that domain only', async ({ browser }) => {
  const dave = await userPage(browser, ORG.dave);
  await expect(dave.locator('[data-tour="nav-mail"]')).toBeVisible();
  await expect(dave.locator('[data-tour="nav-calendar"]')).toHaveCount(0);
  await dave.context().close();

  const carol = await userPage(browser, ORG.carol);
  await expect(carol.locator('[data-tour="nav-calendar"]')).toBeVisible();
  await carol.goto('/settings/appearance');
  await expect(carol.getByText('Set by your organisation')).toHaveCount(0);
  await carol.context().close();
});

test('a group scope locks a setting for members only, with the reason in place', async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice);
  await expect(alice.locator('[data-tour="nav-calendar"]')).toBeVisible();
  await alice.goto('/settings/appearance');
  const note = alice.getByText('Set by your organisation');
  await expect(note).toHaveCount(1);
  await note.scrollIntoViewIfNeeded();
  await shot(alice, 'user-locked-setting');
  // The locked control can't be reached.
  const row = alice.locator('[data-search-label]').filter({ has: note });
  await expect(row.locator('[inert]')).toHaveCount(1);
  await alice.context().close();
});

test('the lock shows at phone width too', async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice, true);
  // A phone opens the settings on their list.
  await alice.goto('/settings/appearance');
  await alice.getByRole('button', { name: 'Appearance' }).or(alice.getByRole('link', { name: 'Appearance' })).first().click();
  const note = alice.getByText('Set by your organisation');
  await expect(note).toBeVisible();
  await note.scrollIntoViewIfNeeded();
  await shot(alice, 'user-locked-setting-phone');
  await alice.context().close();
});

test('the whole policy exports to one file and imports back', async ({ browser }, testInfo) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto('/admin/organisation');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export policy.json' }).click(),
  ]);
  const exported = testInfo.outputPath('exported-policy.json');
  await download.saveAs(exported);
  const file = JSON.parse(await readFile(exported, 'utf-8'));
  expect(file.scopes.map((s: { label: string }) => s.label)).toEqual(['Org two', 'Org team']);

  // Change it outside Bulwark, as someone keeping it in git would.
  file.scopes = file.scopes.filter((s: { label: string }) => s.label !== 'Org two');
  const edited = path.join(path.dirname(exported), 'edited-policy.json');
  await writeFile(edited, JSON.stringify(file));
  await page.getByLabel('Policy file to import').setInputFiles(edited);
  const preview = page.getByTestId('policy-import-preview');
  await expect(preview).toContainText('Domains and groups: 1 removed');
  await shot(page, 'admin-policy-import-preview');
  await page.getByRole('button', { name: 'Replace the current policy' }).click();
  await expect(preview).toHaveCount(0);
  const after = await getPolicy(admin);
  expect((after.scopes as Array<{ label: string }>).map((s) => s.label)).toEqual(['Org team']);
  await admin.close();

  // org-dave has the calendar again.
  const dave = await userPage(browser, ORG.dave);
  await expect(dave.locator('[data-tour="nav-calendar"]')).toBeVisible();
  await dave.context().close();
});

test('the Organisation pages work at phone width', async ({ browser }) => {
  const admin = await adminContext(browser, true);
  const page = await admin.newPage();
  await page.goto('/admin/organisation');
  await expect(page.getByRole('button', { name: 'Add domains' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'admin-domains-and-groups-phone');
  await admin.close();
});
