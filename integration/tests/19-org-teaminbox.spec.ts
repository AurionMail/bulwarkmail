import { test, expect, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { JmapClient } from './helpers/jmap';
import { emailItem, expandSharedFolders, folderRow } from './helpers/app';
import {
  ORG,
  ORG_PASSWORD,
  ORG_SERVER,
  adminContext,
  getPolicy,
  putPolicy,
  requireOrgEnv,
  shot,
  userPage,
} from './helpers/org';

/**
 * The team inbox plugin (organisation feature 10) through the real UI on a
 * VM 106 test server: installed from a local build through the admin, then
 * org-alice assigns a message of the org-team group to org-bob, bob finds it
 * under "Assigned to me" and marks it done, which takes it out of "Open".
 * carol, who is in no group, and alice's own mailbox get no team actions.
 *
 * IT_TEAM_INBOX_ZIP names the zip (default: the plugins worktree's build).
 * The test messages are created in the group's Inbox over JMAP and
 * destroyed at the end, keywords and all; the plugin is removed and the
 * policy put back.
 */

test.describe.configure({ mode: 'serial', timeout: 240000 });

const ZIP = process.env.IT_TEAM_INBOX_ZIP ?? 'C:/Users/info/worktrees/plugins-org-teaminbox/team-inbox/team-inbox.zip';
const RUN = Date.now().toString(36);
const SELF = `Team inbox bob takes it ${RUN}`;
const FOR_BOB = `Team inbox for bob ${RUN}`;
const OTHER = `Team inbox nobody ${RUN}`;
const OWN = `Team inbox alice own ${RUN}`;

let original: Record<string, unknown>;
const created: Array<{ account: string; accountId: string; id: string; subject: string }> = [];

/** A received-looking message, created by `account` in the Inbox of the account named `accountName`. */
async function createMessage(account: string, accountName: string, subject: string): Promise<void> {
  const client = await JmapClient.connect(account, ORG_PASSWORD);
  const accountId = accountName === account ? client.accountId : client.accountIdByName(accountName);
  const inbox = await client.mailboxByRole('inbox', accountId);
  if (!inbox) throw new Error(`${accountName}: no Inbox`);
  const r = await client.request([
    ['Email/set', {
      accountId,
      create: {
        m: {
          mailboxIds: { [inbox.id]: true },
          keywords: {},
          from: [{ name: 'Customer', email: 'customer@example.net' }],
          to: [{ email: accountName }],
          subject,
          receivedAt: new Date().toISOString(),
          bodyValues: { b: { value: `A message for the team inbox spec (${RUN}).` } },
          textBody: [{ partId: 'b', type: 'text/plain' }],
        },
      },
    }, '0'],
  ]);
  const id = r.methodResponses?.[0]?.[1]?.created?.m?.id;
  if (!id) throw new Error(`could not create "${subject}": ${JSON.stringify(r.methodResponses?.[0])}`);
  created.push({ account, accountId, id, subject });
}

/** The keywords of a test message, as the server has them. */
async function keywordsOf(subject: string): Promise<string[]> {
  const entry = created.find((c) => c.subject === subject);
  if (!entry) return [];
  const client = await JmapClient.connect(entry.account, ORG_PASSWORD);
  const r = await client.request([['Email/get', { accountId: entry.accountId, ids: [entry.id], properties: ['keywords'] }, '0']]);
  return Object.keys(r.methodResponses?.[0]?.[1]?.list?.[0]?.keywords ?? {});
}

async function openTeamInbox(page: Page): Promise<void> {
  await expandSharedFolders(page, ORG.team);
  await folderRow(page, { role: 'inbox', shared: true }).first().click();
}

function filterChip(page: Page, name: string): Locator {
  return page.locator('[data-testid="plugin-list-filters"] button', { hasText: name });
}

/** Right-click a row and wait for the menu to carry the plugin's entries. */
async function rowMenu(page: Page, subject: string): Promise<void> {
  const row = emailItem(page, subject).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await expect(async () => {
    await page.keyboard.press('Escape');
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reply', exact: true }).first().waitFor({ state: 'visible', timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/** The plugin runs once its background frame is there and it has offered its filters. */
async function pluginReady(page: Page): Promise<void> {
  await expect(page.locator('iframe[src*="/plugin-sandbox"]').first()).toBeAttached({ timeout: 60000 });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300000);
  test.setTimeout(300000);
  requireOrgEnv();
  test.skip(!existsSync(ZIP), `build the plugin first: ${ZIP}`);
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  // next dev compiles the sandbox page on first use, which can outlast the plugin's init timeout.
  await admin.request.get('/plugin-sandbox', { timeout: 120000 });
  await admin.request.delete('/api/admin/plugins', { data: { id: 'team-inbox' } });
  const installed = await admin.request.post('/api/admin/plugins', {
    multipart: { file: { name: 'team-inbox.zip', mimeType: 'application/zip', buffer: readFileSync(ZIP) } },
  });
  expect(installed.ok(), await installed.text()).toBe(true);
  const features = { ...(original.features as Record<string, unknown>), pluginsEnabled: true };
  const forced = [...new Set([...((original.forceEnabledPlugins as string[] | undefined) ?? []), 'team-inbox'])];
  await putPolicy(admin, { ...original, features, forceEnabledPlugins: forced });
  await admin.close();

  await createMessage(ORG.alice, ORG.team, OTHER);
  await createMessage(ORG.alice, ORG.team, SELF);
  await createMessage(ORG.alice, ORG.team, FOR_BOB);
  await createMessage(ORG.alice, ORG.alice, OWN);
});

const METADATA = 'urn:ietf:params:jmap:metadata';
const NAMES_ENTRY = 'org.bulwarkmail.plugin.team-inbox';

/** The plugin's names in the team Inbox's shared metadata (only v1.0.0 keeps them). */
async function sharedNames(): Promise<Record<string, unknown> | null> {
  const client = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
  const accountId = client.accountIdByName(ORG.team);
  const inbox = await client.mailboxByRole('inbox', accountId);
  const r = await client.request([['Mailbox/get', { accountId, ids: [inbox!.id], properties: ['id', 'metadata'] }, '0']],
    ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', METADATA]);
  return r.methodResponses?.[0]?.[1]?.list?.[0]?.metadata?.[NAMES_ENTRY] ?? null;
}

test.afterAll(async ({ browser }) => {
  test.setTimeout(180000);
  for (const entry of created) {
    const client = await JmapClient.connect(entry.account, ORG_PASSWORD);
    await client.request([['Email/set', { accountId: entry.accountId, destroy: [entry.id] }, '0']]).catch(() => {});
  }
  // The names the plugin kept in the team Inbox go too (other features keep
  // their own entries there).
  if (ORG_SERVER === '1.0.0') {
    const client = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
    const accountId = client.accountIdByName(ORG.team);
    const inbox = await client.mailboxByRole('inbox', accountId);
    if (inbox) {
      await client.request([['Mailbox/set', { accountId, update: { [inbox.id]: { [`metadata/${NAMES_ENTRY}`]: null } } }, '0']],
        ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', METADATA]).catch(() => {});
    }
  }
  if (!original) return;
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.request.delete('/api/admin/plugins', { data: { id: 'team-inbox' } });
  await admin.close();
});

test('bob takes a message himself from the row menu', async ({ browser }) => {
  const bob = await userPage(browser, ORG.bob);
  await pluginReady(bob);
  await openTeamInbox(bob);
  await expect(filterChip(bob, 'Assigned to me')).toBeVisible({ timeout: 30000 });
  await expect(filterChip(bob, 'Open')).toBeVisible();

  await rowMenu(bob, SELF);
  await expect(bob.getByRole('menuitem', { name: 'Mark done' })).toBeVisible();
  await expect(bob.getByRole('menuitem', { name: 'Reopen' })).toHaveCount(0);
  await expect(bob.getByRole('menuitem', { name: 'Unassign' })).toHaveCount(0);
  await bob.getByRole('menuitem', { name: 'Assign to me' }).click();
  await expect(emailItem(bob, SELF).first().locator('[data-plugin-row-badge="team-inbox-assignee"]')).toHaveText('Me', { timeout: 20000 });
  await expect.poll(() => keywordsOf(SELF)).toContain(`$assigned:${await principalId(ORG.bob)}`);
  await bob.context().close();
});

async function principalId(email: string): Promise<string> {
  return (await JmapClient.connect(email, ORG_PASSWORD)).accountId;
}

test('alice assigns a team message to bob', async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice);
  await pluginReady(alice);
  await openTeamInbox(alice);
  await expect(emailItem(alice, SELF).first().locator('[data-plugin-row-badge="team-inbox-assignee"]')).toBeVisible({ timeout: 30000 });
  await shot(alice, 'teaminbox-list-badges');

  await rowMenu(alice, FOR_BOB);
  await alice.getByRole('menuitem', { name: 'Assign to…' }).click();
  const dialog = alice.locator('[data-plugin-dialog="team-inbox"]');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  const frame = dialog.frameLocator('iframe').first();
  // Bob is known by name where the server has metadata or a directory, else
  // by his id, as the team member messages were assigned to lately.
  const bobId = await principalId(ORG.bob);
  const bobRow = frame.getByRole('listitem').filter({ hasText: new RegExp(`org-bob@example\\.org|Id ${bobId}$`) }).first();
  await expect(bobRow).toBeVisible({ timeout: 30000 });
  await expect(frame.getByRole('listitem').filter({ hasText: 'You' })).toHaveCount(1);
  await shot(alice, 'teaminbox-assign-dialog');
  await bobRow.click();
  await expect(dialog).toHaveCount(0, { timeout: 20000 });

  await expect.poll(() => keywordsOf(FOR_BOB), { timeout: 20000 }).toContain(`$assigned:${bobId}`);
  const forBobBadge = emailItem(alice, FOR_BOB).first().locator('[data-plugin-row-badge="team-inbox-assignee"]');
  await expect(forBobBadge).toBeVisible({ timeout: 20000 });
  // The badge names bob where the server shares names (metadata on v1.0.0,
  // or a directory); without either it says the assignee isn't known.
  if (ORG_SERVER === '1.0.0') {
    await expect(forBobBadge).toHaveAttribute('title', `Assigned to Org Bob <${ORG.bob}>`);
    await expect(forBobBadge).toHaveText('Org');
  } else {
    await expect(forBobBadge).toHaveAttribute('title', /Assigned to (Org Bob|a team member whose name Bulwark doesn't know)/);
  }

  // Alice's own mailbox gets no team actions and no filters.
  await folderRow(alice, { role: 'inbox', shared: false }).first().click();
  await expect(emailItem(alice, OWN).first()).toBeVisible({ timeout: 30000 });
  await expect(alice.locator('[data-testid="plugin-list-filters"]')).toHaveCount(0);
  await rowMenu(alice, OWN);
  await expect(alice.getByRole('menuitem', { name: 'Assign to me' })).toHaveCount(0);
  await expect(alice.getByRole('menuitem', { name: 'Mark done' })).toHaveCount(0);
  await alice.context().close();
});

test('on Stalwart v1.0.0 the names are shared in the team Inbox\'s metadata', async () => {
  test.skip(ORG_SERVER !== '1.0.0', 'only the v1.0.0 release keeps metadata (facts §2)');
  const names = await sharedNames() as { people?: Record<string, { n: string; e: string }> } | null;
  const [aliceId, bobId] = [await principalId(ORG.alice), await principalId(ORG.bob)];
  expect(names?.people?.[aliceId]?.e).toBe(ORG.alice);
  expect(names?.people?.[bobId]?.e).toBe(ORG.bob);
});

test('bob finds it under "Assigned to me" and marking it done takes it out of "Open"', async ({ browser }) => {
  const bob = await userPage(browser, ORG.bob);
  await pluginReady(bob);
  await openTeamInbox(bob);
  await expect(emailItem(bob, OTHER).first()).toBeVisible({ timeout: 30000 });

  await filterChip(bob, 'Assigned to me').click();
  await expect(filterChip(bob, 'Assigned to me')).toHaveAttribute('aria-pressed', 'true');
  await expect(emailItem(bob, FOR_BOB).first()).toBeVisible({ timeout: 30000 });
  await expect(emailItem(bob, SELF).first()).toBeVisible();
  await expect(emailItem(bob, OTHER)).toHaveCount(0);
  await shot(bob, 'teaminbox-assigned-to-me');

  // Done from the reader toolbar.
  await emailItem(bob, FOR_BOB).first().click();
  const markDone = bob.locator('[data-plugin-actions="reader-actions"]').getByRole('button', { name: 'Mark done' });
  await expect(markDone).toBeVisible({ timeout: 30000 });
  await markDone.click();
  await expect(bob.locator('[data-plugin-actions="reader-actions"]').getByRole('button', { name: 'Reopen' })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => keywordsOf(FOR_BOB), { timeout: 20000 }).toContain('$done');
  await expect(emailItem(bob, FOR_BOB).first().locator('[data-plugin-row-badge="team-inbox-done"]')).toBeVisible({ timeout: 20000 });

  await filterChip(bob, 'Open').click();
  await expect(emailItem(bob, FOR_BOB)).toHaveCount(0, { timeout: 30000 });
  await expect(emailItem(bob, SELF).first()).toBeVisible();
  await shot(bob, 'teaminbox-open-filter');

  // Off again: the chip's second click removes the filter.
  await filterChip(bob, 'Open').click();
  await filterChip(bob, 'Assigned to me').click();
  await expect(emailItem(bob, OTHER).first()).toBeVisible({ timeout: 30000 });
  await expect(emailItem(bob, FOR_BOB).first()).toBeVisible();
  await bob.context().close();
});

test('carol, in no group, gets no team actions or filters', async ({ browser }) => {
  await createMessage(ORG.carol, ORG.carol, `Team inbox carol ${RUN}`);
  const carol = await userPage(browser, ORG.carol);
  await pluginReady(carol);
  await expect(emailItem(carol, `Team inbox carol ${RUN}`).first()).toBeVisible({ timeout: 30000 });
  await expect(carol.locator('[data-testid="plugin-list-filters"]')).toHaveCount(0);
  await rowMenu(carol, `Team inbox carol ${RUN}`);
  await expect(carol.getByRole('menuitem', { name: 'Assign to me' })).toHaveCount(0);
  await expect(carol.getByRole('menuitem', { name: 'Assign to…' })).toHaveCount(0);
  await carol.context().close();
});

test('on a phone the filters fit and the actions are in the message\'s More menu', async ({ browser }) => {
  const bob = await userPage(browser, ORG.bob, true);
  await pluginReady(bob);
  // The folder list is behind the header's menu button on phones.
  await bob.locator('[data-mobile-mail-header] button').first().click();
  await openTeamInbox(bob);
  const filters = bob.locator('[data-testid="plugin-list-filters"]');
  await expect(filters).toBeVisible({ timeout: 30000 });
  for (const chip of await filters.getByRole('button').all()) {
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
  }
  expect(await bob.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(bob, 'teaminbox-phone-filters');

  await emailItem(bob, OTHER).first().click();
  await bob.getByRole('button', { name: 'More actions' }).last().click();
  await expect(bob.getByRole('menuitem', { name: 'Assign to me' })).toBeVisible({ timeout: 20000 });
  await expect(bob.getByRole('menuitem', { name: 'Mark done' })).toBeVisible();
  await shot(bob, 'teaminbox-phone-more');
  await bob.context().close();
});

test.afterAll(() => {
  console.log(`team inbox spec ran on ${ORG_SERVER}`);
});
