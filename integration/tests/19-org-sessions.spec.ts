import { test, expect, type Page } from '@playwright/test';
import {
  ORG,
  ORG_PASSWORD,
  adminContext,
  getPolicy,
  putPolicy,
  requireOrgEnv,
  shot,
  userPage,
} from './helpers/org';
import { JmapClient } from './helpers/jmap';
import { emailItem, openComposer, setSubject, waitDraftSaved } from './helpers/app';

/**
 * Session idle timeout (organisation feature 4), through the real UI on a
 * VM 106 test server. The admin sets one minute with a 30-second warning for
 * example.org on Organisation > Security, Off for org-two.test, and two
 * minutes for everyone else. org-alice gets the warning, stays, then lets it
 * run out: Bulwark saves her minimised draft and signs her out with the
 * reason on the login page. org-dave's domain has no timeout. The admin's
 * policy is put back afterwards.
 */

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const INBOX_SUBJECT = `Session limits inbox ${RUN}`;
const DRAFT_SUBJECT = `Session limits draft ${RUN}`;

let original: Record<string, unknown>;
let alice: JmapClient;

async function draftSubjects(client: JmapClient): Promise<string[]> {
  const drafts = await client.mailboxByRole('drafts');
  if (!drafts) throw new Error('No Drafts mailbox');
  const r = await client.request([
    ['Email/query', { accountId: client.accountId, filter: { inMailbox: drafts.id }, sort: [{ property: 'receivedAt', isAscending: false }], limit: 50 }, '0'],
    ['Email/get', { accountId: client.accountId, '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' }, properties: ['subject'] }, '1'],
  ]);
  return (r.methodResponses[1][1].list as Array<{ subject: string }>).map((e) => e.subject);
}

async function removeTestMail(client: JmapClient): Promise<void> {
  const r = await client.request([
    ['Email/query', { accountId: client.accountId, filter: { text: RUN }, limit: 50 }, '0'],
  ]);
  const ids = r.methodResponses[0][1].ids as string[];
  if (ids.length) await client.request([['Email/set', { accountId: client.accountId, destroy: ids }, '0']]);
}

const warning = (page: Page) => page.getByTestId('session-timeout-dialog');

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, {
    ...original,
    restrictions: {},
    features: {},
    organisation: { ...(original.organisation as object), session: { idleMinutes: 0, maxHours: 0, warnSeconds: 60 } },
    scopes: [
      { id: 'sessions-example', label: 'Example', match: { domains: ['example.org'] }, policy: {} },
      { id: 'sessions-two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: {} },
    ],
  });
  await admin.close();

  // A message for org-alice to open while composing, which minimises the composer.
  alice = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
  const inbox = await alice.mailboxByRole('inbox');
  const r = await alice.request([
    ['Email/set', {
      accountId: alice.accountId,
      create: {
        m: {
          mailboxIds: { [inbox!.id]: true },
          keywords: { $seen: true },
          from: [{ name: 'Org Bob', email: ORG.bob }],
          to: [{ email: ORG.alice }],
          subject: INBOX_SUBJECT,
          receivedAt: new Date().toISOString(),
          bodyValues: { b: { value: 'Open me while writing.' } },
          textBody: [{ partId: 'b', type: 'text/plain' }],
        },
      },
    }, '0'],
  ]);
  expect(r.methodResponses[0][1].created?.m, JSON.stringify(r.methodResponses[0][1])).toBeTruthy();
});

test.afterAll(async ({ browser }) => {
  if (original) {
    const admin = await adminContext(browser);
    await putPolicy(admin, original);
    await admin.close();
  }
  if (alice) await removeTestMail(alice);
});

test('the admin sets the idle timeout per domain on Organisation > Security', async ({ browser }) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto('/admin/org-security');
  const idle = page.getByLabel('Sign out after inactivity (minutes)');
  const warn = page.getByLabel('Warning before signing out (seconds)');
  await expect(idle).toBeVisible();

  // Everyone: two minutes, so org-dave would be warned within the test if his scope didn't apply.
  await idle.fill('2');
  // example.org: one minute, warned 30 seconds before.
  await page.getByTestId('org-scope-bar').getByRole('button', { name: 'Example', exact: true }).click();
  await expect(idle).toHaveValue('2');
  await expect(page.getByText('From Everyone: 2 minutes')).toBeVisible();
  await idle.fill('1');
  await warn.fill('30');
  // org-two.test: off.
  await page.getByTestId('org-scope-bar').getByRole('button', { name: 'Org two', exact: true }).click();
  await idle.fill('');
  await expect(idle).toHaveAttribute('placeholder', 'Off');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByTestId('org-scope-bar').getByRole('button', { name: 'Example', exact: true }).click();
  await page.locator('[data-settings-section="sessions"]').scrollIntoViewIfNeeded();
  await shot(page, 'sessions-admin-page');

  const policy = await getPolicy(admin);
  expect((policy.organisation as { session: unknown }).session).toEqual({ idleMinutes: 2, maxHours: 0, warnSeconds: 60 });
  const scopes = policy.scopes as Array<{ id: string; policy: { organisation?: { session?: unknown } } }>;
  expect(scopes.find((s) => s.id === 'sessions-example')?.policy.organisation?.session).toEqual({ idleMinutes: 1, warnSeconds: 30 });
  expect(scopes.find((s) => s.id === 'sessions-two')?.policy.organisation?.session).toEqual({ idleMinutes: 0 });
  await admin.close();
});

test('the admin page works at phone width', async ({ browser }) => {
  const admin = await adminContext(browser, true);
  const page = await admin.newPage();
  await page.goto('/admin/org-security');
  const idle = page.getByLabel('Sign out after inactivity (minutes)');
  await idle.scrollIntoViewIfNeeded();
  await expect(idle).toBeVisible();
  const box = await idle.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'sessions-admin-page-phone');
  await admin.close();
});

test('org-alice is warned, stays, then is signed out with her minimised draft saved; org-dave is not', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const [page, dave] = await Promise.all([userPage(browser, ORG.alice), userPage(browser, ORG.dave)]);

  // Write, let the autosave store a first version, write more, then open a
  // message: the composer is minimised with the newer text only in memory.
  await expect(emailItem(page, INBOX_SUBJECT).first()).toBeVisible({ timeout: 30000 });
  await openComposer(page);
  await setSubject(page, DRAFT_SUBJECT);
  await waitDraftSaved(page);
  await setSubject(page, `${DRAFT_SUBJECT} final`);
  await emailItem(page, INBOX_SUBJECT).first().click();
  await expect(page.getByText('Continue draft')).toBeVisible();
  let lastActivity = Date.now();
  expect(await draftSubjects(alice)).toContain(DRAFT_SUBJECT);
  expect(await draftSubjects(alice)).not.toContain(`${DRAFT_SUBJECT} final`);

  // The warning comes 30 seconds before the minute is up.
  await expect(warning(page)).toBeVisible({ timeout: 45000 });
  const warnedAfter = Date.now() - lastActivity;
  expect(warnedAfter).toBeGreaterThan(25000);
  expect(warnedAfter).toBeLessThan(40000);
  await expect(warning(page)).toContainText('Are you still there?');
  await shot(page, 'sessions-idle-warning');

  await page.getByRole('button', { name: 'Stay signed in' }).click();
  lastActivity = Date.now();
  await expect(warning(page)).toBeHidden();

  // Left alone: warned again, then signed out a minute after the last activity.
  await expect(warning(page)).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#username')).toBeVisible({ timeout: 60000 });
  const signedOutAfter = Date.now() - lastActivity;
  expect(signedOutAfter).toBeGreaterThan(55000);
  await expect(page.getByTestId('session-expired-reason')).toHaveText('You were signed out after 1 minute without activity.');
  await shot(page, 'sessions-login-reason');

  // The minimised composer saved its newer text before the sign-out.
  await expect.poll(() => draftSubjects(alice), { timeout: 15000 }).toContain(`${DRAFT_SUBJECT} final`);

  // org-two.test turns the timeout off: org-dave, idle just as long, is still in.
  await expect(warning(dave)).toHaveCount(0);
  await expect(dave.locator('[data-testid="account-switcher"]').first()).toBeVisible();
  await page.context().close();
  await dave.context().close();
});

test('the warning fits a phone and "Stay signed in" works there', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const page = await userPage(browser, ORG.alice, true);
  await expect(warning(page)).toBeVisible({ timeout: 45000 });
  const dialog = page.getByRole('alertdialog');
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'sessions-idle-warning-phone');
  await page.getByRole('button', { name: 'Stay signed in' }).tap();
  await expect(warning(page)).toBeHidden();
  await expect(page.locator('[data-testid="account-switcher"]').first()).toBeVisible();
  await page.context().close();
});
