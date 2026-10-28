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
import { expandSharedFolders, folderRow } from './helpers/app';

/**
 * Delegates (organisation feature 7), through the real UI on a VM 106 test
 * server: org-alice gives org-carol read access in one dialog, carol sees
 * alice's Inbox and calendar, alice changes it to read and write and then
 * removes it everywhere, each step checked over JMAP. The admin hides the
 * section for a group and limits the rights for a domain on Organisation >
 * Sharing. Every grant made here is taken away again, and the admin's policy
 * is put back.
 *
 * With directory queries off (Stalwart 1.0's default) alice can't look up
 * carol, so the typed address shows the note; carol then shares her Drafts
 * with alice, which makes her known, and alice picks her from the list.
 */

test.describe.configure({ mode: 'serial' });

const CALENDARS = 'urn:ietf:params:jmap:calendars';
const CONTACTS = 'urn:ietf:params:jmap:contacts';
const MAIL_SHARE = 'urn:ietf:params:jmap:mail:share';
const USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', MAIL_SHARE, CALENDARS, CONTACTS, 'urn:ietf:params:jmap:principals'];

let original: Record<string, unknown>;
let alice: JmapClient;
let carol: JmapClient;
let directoryOff = false;
let carolDraftsId = '';

type Grants = Record<string, Record<string, Record<string, boolean>>>;

/** alice's grants per item ("mailbox:a", "calendar:b", ...) for one principal. */
async function grantsFor(principalId: string): Promise<Grants[string]> {
  const r = await alice.request([
    ['Mailbox/get', { accountId: alice.accountId, ids: null, properties: ['id', 'role', 'shareWith'] }, 'm'],
    ['Calendar/get', { accountId: alice.accountId, ids: null, properties: ['id', 'shareWith'] }, 'c'],
    ['AddressBook/get', { accountId: alice.accountId, ids: null, properties: ['id', 'shareWith'] }, 'a'],
  ], USING);
  const out: Grants[string] = {};
  const kinds: Record<string, string> = { m: 'mailbox', c: 'calendar', a: 'addressBook' };
  for (const [, result, id] of r.methodResponses as [string, { list: Array<{ id: string; role?: string; shareWith?: Grants[string] | null }> }, string][]) {
    for (const item of result.list ?? []) {
      const rights = item.shareWith?.[principalId];
      if (rights) out[`${kinds[id]}:${item.role ?? item.id}`] = rights;
    }
  }
  return out;
}

/** Takes every grant of `principalId` off alice's folders, calendars and address books. */
async function revokeAllOverJmap(principalId: string): Promise<void> {
  const r = await alice.request([
    ['Mailbox/get', { accountId: alice.accountId, ids: null, properties: ['id', 'shareWith'] }, 'm'],
    ['Calendar/get', { accountId: alice.accountId, ids: null, properties: ['id', 'shareWith'] }, 'c'],
    ['AddressBook/get', { accountId: alice.accountId, ids: null, properties: ['id', 'shareWith'] }, 'a'],
  ], USING);
  const methods: Record<string, string> = { m: 'Mailbox/set', c: 'Calendar/set', a: 'AddressBook/set' };
  const calls: [string, Record<string, unknown>, string][] = [];
  for (const [, result, id] of r.methodResponses as [string, { list: Array<{ id: string; shareWith?: Record<string, unknown> | null }> }, string][]) {
    const update = Object.fromEntries((result.list ?? [])
      .filter((item) => item.shareWith && principalId in item.shareWith)
      .map((item) => [item.id, { [`shareWith/${principalId}`]: null }]));
    if (Object.keys(update).length) calls.push([methods[id], { accountId: alice.accountId, update }, id]);
  }
  if (calls.length) await alice.request(calls, USING);
}

async function setCarolDraftsShare(on: boolean): Promise<void> {
  await carol.request([
    ['Mailbox/set', { accountId: carol.accountId, update: { [carolDraftsId]: { [`shareWith/${alice.accountId}`]: on ? { mayReadItems: true } : null } } }, '0'],
  ], USING);
}

async function openSharing(page: Page, phone = false): Promise<void> {
  await page.goto('/settings/sharing');
  if (phone) {
    await page.getByRole('button', { name: 'Sharing' }).or(page.getByRole('link', { name: 'Sharing' })).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Delegates' })).toBeVisible({ timeout: 30000 });
}

const dialog = (page: Page) => page.getByRole('dialog');

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, { ...original, scopes: [], restrictions: {}, features: {} });
  await admin.close();

  alice = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
  carol = await JmapClient.connect(ORG.carol, ORG_PASSWORD);
  carolDraftsId = (await carol.mailboxByRole('drafts'))!.id;
  const q = await alice.request([['Principal/query', { accountId: alice.accountId, filter: { email: ORG.carol } }, '0']], USING);
  directoryOff = q.methodResponses[0][0] === 'error';
  // Leftovers of an earlier run.
  await revokeAllOverJmap(carol.accountId);
  await setCarolDraftsShare(false);
});

test.afterAll(async ({ browser }) => {
  if (alice && carol) {
    await revokeAllOverJmap(carol.accountId);
    await setCarolDraftsShare(false);
    expect(await grantsFor(carol.accountId)).toEqual({});
  }
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
});

test('a typed address works, or says the administrator has to turn on directory lookups', async ({ browser }) => {
  const page = await userPage(browser, ORG.alice);
  await openSharing(page);
  await page.getByRole('button', { name: 'Give access' }).click();
  await dialog(page).getByRole('textbox', { name: 'Person' }).fill(ORG.carol);
  await dialog(page).getByRole('button', { name: `Use ${ORG.carol}` }).click();
  if (directoryOff) {
    await expect(dialog(page).getByTestId('delegate-directory-off'))
      .toContainText('Your administrator has to turn on directory lookups in Stalwart before you can add someone new.');
    await shot(page, 'delegates-directory-off');
  } else {
    await expect(dialog(page).getByText(ORG.carol)).toBeVisible();
  }
  await page.context().close();
});

test('alice gives carol read access to her mail, calendar and contacts in one step', async ({ browser }) => {
  if (directoryOff) await setCarolDraftsShare(true);
  const page = await userPage(browser, ORG.alice);
  await openSharing(page);
  await expect(page.getByText('Nobody has access to your mail, calendars, contacts or files.')).toBeVisible();
  await page.getByRole('button', { name: 'Give access' }).click();
  const d = dialog(page);
  await expect(d.getByText("Stalwart doesn't let them send as you or on your behalf.", { exact: false })).toBeVisible();
  await d.getByRole('textbox', { name: 'Person' }).fill('org-carol');
  await d.getByRole('option', { name: /org-carol@example\.org/ }).click();
  await expect(d.getByRole('radio', { name: /^Read See/ })).toBeChecked();
  await shot(page, 'delegates-dialog');
  await d.getByRole('button', { name: 'Give access' }).click();
  await expect(d).toBeHidden();

  const row = page.getByTestId('delegate-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(ORG.carol);
  await expect(row).toContainText('All mail folders');
  await expect(row).toContainText('Read');
  await shot(page, 'delegates-overview');

  const grants = await grantsFor(carol.accountId);
  expect(grants['mailbox:inbox']).toMatchObject({ mayReadItems: true, mayAddItems: false, mayRemoveItems: false, maySubmit: false });
  expect(grants['mailbox:sent']).toMatchObject({ mayReadItems: true, mayAddItems: false });
  const calendars = Object.entries(grants).filter(([k]) => k.startsWith('calendar:'));
  expect(calendars).toHaveLength(1);
  expect(calendars[0][1]).toMatchObject({ mayReadItems: true, mayWriteAll: false });
  const books = Object.entries(grants).filter(([k]) => k.startsWith('addressBook:'));
  expect(books).toHaveLength(1);
  expect(books[0][1]).toMatchObject({ mayRead: true, mayWrite: false });
  await page.context().close();
});

test("carol sees alice's Inbox and calendar", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await userPage(browser, ORG.carol);
  await expandSharedFolders(page, ORG.alice);
  await expect(folderRow(page, { role: 'inbox', shared: true }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, 'delegates-carol-sees-inbox');
  await page.goto('/calendar');
  await expect(page.getByText(`Stalwart Calendar (${ORG.alice})`).first()).toBeVisible({ timeout: 30000 });
  await page.context().close();
});

test('Change gives carol read and write access, and only to the Inbox', async ({ browser }) => {
  const page = await userPage(browser, ORG.alice);
  await openSharing(page);
  await page.getByTestId('delegate-row').getByRole('button', { name: 'Change' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: `Change access for ${ORG.carol}` })).toBeVisible();
  await d.getByRole('radiogroup', { name: 'Mail' }).getByText('Inbox only').click();
  await d.getByRole('radio', { name: /^Read and write/ }).check();
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByTestId('delegate-row')).toContainText('Read and write');

  const grants = await grantsFor(carol.accountId);
  expect(grants['mailbox:inbox']).toMatchObject({ mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySubmit: false, mayShare: false });
  // Change replaces: the other folders lost their access.
  expect(Object.keys(grants).filter((k) => k.startsWith('mailbox:'))).toEqual(['mailbox:inbox']);
  const calendars = Object.entries(grants).filter(([k]) => k.startsWith('calendar:'));
  expect(calendars[0][1]).toMatchObject({ mayReadItems: true, mayWriteAll: true, mayShare: false });
  await page.context().close();
});

test('Remove access takes it away everywhere', async ({ browser }) => {
  const page = await userPage(browser, ORG.alice);
  await openSharing(page);
  await page.getByTestId('delegate-row').getByRole('button', { name: 'Remove access' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByText('Nobody has access to your mail, calendars, contacts or files.')).toBeVisible();
  expect(await grantsFor(carol.accountId)).toEqual({});
  await page.context().close();
});

test('the admin limits delegates to read for one domain and hides them for a group', async ({ browser }) => {
  const admin = await adminContext(browser);
  const policy = await getPolicy(admin);
  await putPolicy(admin, {
    ...policy,
    scopes: [
      { id: 'delegates-team', label: 'Org team', match: { groups: [ORG.team] }, policy: {} },
      { id: 'delegates-example', label: 'Example', match: { domains: ['example.org'] }, policy: {} },
    ],
  });

  const page = await admin.newPage();
  await page.goto('/admin/org-sharing');
  await expect(page.getByRole('heading', { name: 'Delegates' })).toBeVisible();
  // Example (a domain scope): untick write.
  const scopeBar = page.getByTestId('org-scope-bar');
  await scopeBar.getByRole('button', { name: 'Example', exact: true }).click();
  const section = page.locator('[data-settings-section="delegates"]');
  await section.getByLabel('write', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  // Org team (a group scope): hide.
  await scopeBar.getByRole('button', { name: 'Org team', exact: true }).click();
  await section.getByLabel('Hide', { exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await shot(page, 'delegates-admin');

  const saved = await getPolicy(admin);
  const scopes = saved.scopes as Array<{ id: string; policy: { restrictions?: Record<string, unknown> } }>;
  expect(scopes.find((s) => s.id === 'delegates-example')!.policy.restrictions).toEqual({ delegationRights: { allowedValues: ['read'] } });
  expect(scopes.find((s) => s.id === 'delegates-team')!.policy.restrictions).toEqual({ delegation: { hidden: true } });
  await page.close();
  await admin.close();
});

test('a member of the hidden group gets no Delegates section', async ({ browser }) => {
  const page = await userPage(browser, ORG.alice);
  await page.goto('/settings/account');
  await expect(page.getByRole('heading', { name: 'Account' }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Sharing' }).or(page.getByRole('link', { name: 'Sharing' }))).toHaveCount(0);
  await page.goto('/settings/sharing');
  await expect(page.getByRole('heading', { name: 'Delegates' })).toHaveCount(0);
  await page.context().close();
});

test('the domain limit offers only read, says why, and the dialog fills a phone screen', async ({ browser }) => {
  // carol is in example.org but not in the group.
  const page = await userPage(browser, ORG.carol, true);
  await openSharing(page, true);
  await page.getByRole('button', { name: 'Give access' }).click();
  const d = dialog(page);
  const rights = d.getByTestId('delegate-rights');
  await expect(rights.getByRole('radio')).toHaveCount(1);
  await expect(rights.getByRole('radio', { name: /^Read See/ })).toBeChecked();
  await expect(rights.getByText('Set by your organisation')).toBeVisible();
  const box = await d.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390 });
  await shot(page, 'delegates-dialog-phone');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await shot(page, 'delegates-overview-phone');
  await page.context().close();
});
