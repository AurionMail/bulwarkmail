import { test, expect, type Page } from '@playwright/test';
import { JMAP_URL } from './helpers/config';
import { expandSharedFolders, emailItem, folderRow } from './helpers/app';
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
 * Shared tags in group mailboxes (organisation feature 6), through the real
 * UI. On the v1.0.0 release (label 1.0.0) the definitions live in the
 * metadata of org-team's Inbox: org-alice defines "Urgent" in red and tags a
 * message, org-bob sees the same name and colour, and a group scope that
 * locks `sharedTags` makes the editor read-only. On servers without working
 * metadata (0.16, the 1.0 test build) there is no shared editor, the tags on
 * group messages still show, and the app stays online.
 *
 * Cleanup: the test message (and with it its tags) is destroyed, the
 * `org.bulwarkmail.tags` metadata entry is set back to null, the policy is
 * put back. Other `org.bulwarkmail.*` entries (templates) are never touched.
 */

test.describe.configure({ mode: 'serial' });

const SUBJECT = `Shared tags ${Date.now()}`;
const OWN_SUBJECT = `Own tags ${Date.now()}`;
const HAS_METADATA = ORG_SERVER === '1.0.0';

// --- JMAP, as org-alice, straight to the server --------------------------

type Call = [string, Record<string, unknown>, string];
let api: { url: string; team: string; inbox: string; own: string; ownInbox: string } | null = null;
let messageId: string | null = null;
/** A message in org-alice's own Inbox with the same keyword, for the unified inbox. */
let ownMessageId: string | null = null;

const auth = () => `Basic ${Buffer.from(`${ORG.alice}:${ORG_PASSWORD}`).toString('base64')}`;

/** The API url, org-team's account id and its Inbox id, looked up once. */
async function ensureApi(): Promise<NonNullable<typeof api>> {
  if (!api) {
    const session = await (await fetch(`${JMAP_URL}/.well-known/jmap`, { headers: { Authorization: auth() } })).json();
    const team = Object.entries(session.accounts as Record<string, { name: string }>).find(([, a]) => a.name === ORG.team)![0];
    const own = session.primaryAccounts['urn:ietf:params:jmap:mail'] as string;
    api = { url: `${JMAP_URL}${new URL(session.apiUrl).pathname}`, team, inbox: '', own, ownInbox: '' };
    const res = await jmapRaw([
      ['Mailbox/query', { accountId: team, filter: { role: 'inbox' } }, 'q'],
      ['Mailbox/query', { accountId: own, filter: { role: 'inbox' } }, 'o'],
    ]);
    api.inbox = res[0][1].ids[0];
    api.ownInbox = res[1][1].ids[0];
  }
  return api;
}

async function jmap(calls: Call[], using?: string[]) {
  await ensureApi();
  return jmapRaw(calls, using);
}

async function jmapRaw(calls: Call[], using = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']) {
  const res = await fetch(api!.url, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ using, methodCalls: calls }),
  });
  expect(res.ok, `JMAP ${res.status}`).toBe(true);
  return (await res.json()).methodResponses as Array<[string, any, string]>;
}

const META_USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:metadata'];

async function sharedTagsOnServer(): Promise<unknown> {
  const res = await jmap([['Mailbox/get', { accountId: api!.team, ids: [api!.inbox], properties: ['metadata'] }, 'g']], META_USING);
  return res[0][1].list[0].metadata?.['org.bulwarkmail.tags'] ?? null;
}

async function clearSharedTags(): Promise<void> {
  await jmap([['Mailbox/set', { accountId: api!.team, update: { [api!.inbox]: { 'metadata/org.bulwarkmail.tags': null } } }, 's']], META_USING);
}

async function messageKeywords(): Promise<Record<string, boolean>> {
  const res = await jmap([['Email/get', { accountId: api!.team, ids: [messageId], properties: ['keywords'] }, 'g']]);
  return res[0][1].list[0].keywords;
}

// --- UI helpers ----------------------------------------------------------

async function openTeamInbox(page: Page): Promise<void> {
  await expandSharedFolders(page, ORG.team);
  await folderRow(page, { role: 'inbox', shared: true }).first().click();
  await expect(emailItem(page, SUBJECT).first()).toBeVisible({ timeout: 30000 });
}

/** Settings > Folders & tags, scrolled to the shared tags of org-team. */
async function openSharedTagSettings(page: Page, phone = false) {
  if (phone) {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Folders & tags' }).or(page.getByRole('link', { name: 'Folders & tags' })).first().click();
  } else {
    await page.goto('/settings/organize/shared-tags');
  }
  // The block is drawn again once the tags have loaded.
  const account = page.locator('[data-testid="shared-tags-account"]:not([data-status="loading"])').filter({ hasText: ORG.team });
  await expect(account).toBeVisible({ timeout: 30000 });
  await account.scrollIntoViewIfNeeded();
  return account;
}

let original: Record<string, unknown>;

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, { ...original, restrictions: {}, scopes: [] });
  await admin.close();

  // A message in org-team's Inbox; on servers without metadata it carries a
  // tag set by another client, which must still show.
  const keywords = HAS_METADATA ? {} : { '$label:from-another-client': true };
  const { team, inbox, own, ownInbox } = await ensureApi();
  const message = (mailbox: string, to: string, subject: string, kw: Record<string, boolean>) => ({
    mailboxIds: { [mailbox]: true },
    from: [{ name: 'Org Alice', email: ORG.alice }],
    to: [{ email: to }],
    subject,
    keywords: kw,
    bodyValues: { b: { value: 'A message for the shared tags spec.' } },
    textBody: [{ partId: 'b', type: 'text/plain' }],
  });
  const res = await jmap([['Email/set', { accountId: team, create: { m: message(inbox, ORG.team, SUBJECT, keywords) } }, 'c']]);
  messageId = res[0][1].created.m.id;
  if (HAS_METADATA) {
    const mine = await jmap([['Email/set', { accountId: own, create: { m: message(ownInbox, ORG.alice, OWN_SUBJECT, { '$label:urgent': true }) } }, 'c']]);
    ownMessageId = mine[0][1].created.m.id;
  }
  if (HAS_METADATA) await clearSharedTags();
});

test.afterAll(async ({ browser }) => {
  if (messageId) await jmap([['Email/set', { accountId: api!.team, destroy: [messageId] }, 'd']]);
  if (ownMessageId) await jmap([['Email/set', { accountId: api!.own, destroy: [ownMessageId] }, 'd']]);
  if (HAS_METADATA && api) {
    await clearSharedTags();
    expect(await sharedTagsOnServer()).toBeNull();
  }
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
});

test.describe('on a server with metadata', () => {
  test.skip(!HAS_METADATA, 'shared definitions need Stalwart v1.0.0 metadata');

  test('org-alice defines "Urgent" in red for org-team and tags a message with it', async ({ browser }) => {
    const alice = await userPage(browser, ORG.alice);
    const account = await openSharedTagSettings(alice);
    await account.getByRole('button', { name: 'Add shared tag' }).click();
    const form = account.getByTestId('shared-tag-form');
    await form.getByLabel('Name').fill('Urgent');
    await form.getByRole('button', { name: 'red', exact: true }).click();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(account.locator('[data-testid="shared-tag-row"][data-tag-id="urgent"]')).toBeVisible();
    await shot(alice, 'tags-settings-editor');
    await expect.poll(sharedTagsOnServer).toEqual({ tags: { urgent: { label: 'Urgent', color: 'red' } } });

    await alice.goto('/');
    await openTeamInbox(alice);
    // The group's tags are listed under its folders.
    await expect(alice.getByTestId('shared-account-tags').getByText('Urgent')).toBeVisible();

    const row = emailItem(alice, SUBJECT).first();
    await expect(async () => {
      await row.click({ button: 'right' });
      await alice.getByTestId('ctx-tag').waitFor({ state: 'visible', timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await alice.getByTestId('ctx-tag').hover();
    await expect(alice.getByTestId('tag-picker-shared')).toBeVisible();
    await shot(alice, 'tags-picker');
    await alice.getByRole('menuitemcheckbox', { name: 'Urgent' }).click();
    await expect.poll(async () => (await messageKeywords())['$label:urgent']).toBe(true);
    await alice.keyboard.press('Escape');
    await expect(row.getByTitle('Urgent')).toBeVisible();

    // The group's tag in the sidebar counts and lists that group's mail
    // only: her own message with the same keyword stays out.
    const sharedRow = alice.getByTestId('shared-account-tags').getByTestId('folder-row').filter({ hasText: 'Urgent' });
    await expect(sharedRow.getByTestId('folder-counts')).toHaveAttribute('data-total', '1', { timeout: 30000 });
    await sharedRow.click();
    await expect(emailItem(alice, SUBJECT).first()).toBeVisible({ timeout: 30000 });
    await expect(emailItem(alice, OWN_SUBJECT)).toHaveCount(0);
    await expect(sharedRow).toHaveAttribute('data-selected', 'true');
    await shot(alice, 'tags-sidebar-group-view');
    await alice.context().close();
  });

  test('org-bob sees the same name and colour on that message', async ({ browser }) => {
    const bob = await userPage(browser, ORG.bob);
    await openTeamInbox(bob);
    const chip = emailItem(bob, SUBJECT).first().getByTitle('Urgent');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveClass(/bg-red-500\/10/);
    await expect(bob.getByTestId('shared-account-tags').getByText('Urgent')).toBeVisible();
    await shot(bob, 'tags-member-view');

    // Another member's edit arrives without a reload (push: the Inbox's
    // Mailbox state changes with its metadata).
    await jmap([['Mailbox/set', { accountId: api!.team, update: { [api!.inbox]: { 'metadata/org.bulwarkmail.tags/tags/urgent': { label: 'Very urgent', color: 'orange' } } } }, 's']], META_USING);
    const renamed = emailItem(bob, SUBJECT).first().getByTitle('Very urgent');
    await expect(renamed).toBeVisible({ timeout: 30000 });
    await expect(renamed).toHaveClass(/bg-orange-500\/10/);
    await jmap([['Mailbox/set', { accountId: api!.team, update: { [api!.inbox]: { 'metadata/org.bulwarkmail.tags/tags/urgent': { label: 'Urgent', color: 'red' } } } }, 's']], META_USING);
    await expect(emailItem(bob, SUBJECT).first().getByTitle('Urgent')).toBeVisible({ timeout: 30000 });
    await bob.context().close();
  });

  test('the unified inbox names the tags of each message by its own account', async ({ browser }) => {
    // Unified inbox with the group inbox in it, pinned by the policy so a
    // synced setting of the account can't turn it off.
    const admin = await adminContext(browser);
    const policy = await getPolicy(admin);
    await putPolicy(admin, {
      ...policy,
      restrictions: {
        ...(policy.restrictions as Record<string, unknown>),
        enableUnifiedMailbox: { locked: true, value: true },
        includeGroupInUnified: { locked: true, value: true },
      },
    });
    const alice = await userPage(browser, ORG.alice);
    await folderRow(alice, { name: 'unified-inbox' }).first().click({ timeout: 60000 });
    // The same keyword: the group's shared name on the team message, the
    // bare keyword on her own (she has no tag of that name).
    await expect(emailItem(alice, SUBJECT).first().getByTitle('Urgent')).toBeVisible({ timeout: 30000 });
    await expect(emailItem(alice, OWN_SUBJECT).first().getByTitle('urgent', { exact: true })).toBeVisible();
    await shot(alice, 'tags-unified-inbox');
    await alice.context().close();
    await putPolicy(admin, policy);
    await admin.close();
  });

  test('deleting a shared tag warns that it is for everyone, at phone width too', async ({ browser }) => {
    const alice = await userPage(browser, ORG.alice, true);
    const account = await openSharedTagSettings(alice, true);
    await account.getByRole('button', { name: 'Delete Urgent' }).click();
    const confirm = account.getByTestId('shared-tag-delete-confirm');
    await expect(confirm.getByText('Delete for everyone? The tag stays on its messages.')).toBeVisible();
    for (const name of ['Delete', 'Cancel']) {
      const box = await confirm.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await shot(alice, 'tags-delete-confirm-phone');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(account.getByRole('button', { name: 'Edit Urgent' })).toBeFocused();
    expect(await sharedTagsOnServer()).toEqual({ tags: { urgent: { label: 'Urgent', color: 'red' } } });
    await alice.context().close();
  });

  test('a lock applies only to the scope that sets it, read-only with the reason in place', async ({ browser }) => {
    const admin = await adminContext(browser);
    let policy = await getPolicy(admin);
    await putPolicy(admin, {
      ...policy,
      scopes: [
        { id: 'org-two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: { restrictions: { sharedTags: { locked: true } } } },
        { id: 'org-team', label: 'Org team', match: { groups: [ORG.team] }, policy: {} },
      ],
    });

    // A domain scope for another domain leaves org-team's members alone.
    const alice = await userPage(browser, ORG.alice);
    const aliceTags = await openSharedTagSettings(alice);
    await expect(aliceTags.getByRole('button', { name: 'Add shared tag' })).toBeVisible();
    await alice.context().close();

    // The admin locks shared tags for the org-team group on Organisation > Sharing.
    const page = await admin.newPage();
    await page.goto('/admin/org-sharing');
    await expect(page.getByRole('heading', { name: 'Sharing' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Org team' }).click();
    await page.waitForLoadState('networkidle');
    const section = page.getByTestId('org-shared-tags-section');
    await section.getByLabel('Lock').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await shot(page, 'tags-admin-lock');
    policy = await getPolicy(admin);
    const team = (policy.scopes as Array<{ id: string; policy: Record<string, any> }>).find((s) => s.id === 'org-team')!;
    expect(team.policy.restrictions.sharedTags).toEqual({ locked: true });
    expect((policy.restrictions as Record<string, unknown>).sharedTags).toBeUndefined();
    await admin.close();

    const bob = await userPage(browser, ORG.bob);
    const bobTags = await openSharedTagSettings(bob);
    await expect(bobTags.getByText('Set by your organisation')).toBeVisible();
    await expect(bobTags.getByRole('button', { name: 'Add shared tag' })).toHaveCount(0);
    await expect(bobTags.getByRole('button', { name: /^(Edit|Delete|Name) / })).toHaveCount(0);
    await expect(bobTags.locator('[data-tag-id="urgent"]')).toBeVisible();
    await shot(bob, 'tags-settings-locked');
    // Tagging with the shared tags still works.
    await bob.goto('/');
    await openTeamInbox(bob);
    await expect(emailItem(bob, SUBJECT).first().getByTitle('Urgent')).toBeVisible();
    await bob.context().close();
  });

  test('the shared tags work at phone width', async ({ browser }) => {
    const bob = await userPage(browser, ORG.bob, true);
    const account = await openSharedTagSettings(bob, true);
    await expect(account.getByText('Set by your organisation')).toBeVisible();
    await expect(account.locator('[data-tag-id="urgent"]')).toBeVisible();
    const overflow = await bob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(bob, 'tags-settings-phone');
    await bob.context().close();

    const admin = await adminContext(browser, true);
    const page = await admin.newPage();
    await page.goto('/admin/org-sharing');
    await expect(page.getByTestId('org-shared-tags-section')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId('org-shared-tags-section').scrollIntoViewIfNeeded();
    await shot(page, 'tags-admin-phone');
    await admin.close();
  });
});

test.describe('on a server without metadata', () => {
  test.skip(HAS_METADATA, 'covered above');

  test('no shared editor, the tags on group messages still show, and the app stays online', async ({ browser }) => {
    const alice = await userPage(browser, ORG.alice);
    const requests: string[] = [];
    alice.on('request', (request) => {
      const body = request.postData() ?? '';
      if (body.includes('urn:ietf:params:jmap:metadata')) requests.push(body);
    });
    await openTeamInbox(alice);
    await expect(emailItem(alice, SUBJECT).first().getByTitle('from-another-client')).toBeVisible();
    await expect(alice.getByTestId('shared-account-tags')).toHaveCount(0);

    const account = await openSharedTagSettings(alice);
    // 0.16 has no metadata; the 1.0 test build has it but drops the request.
    await expect(account.getByTestId(ORG_SERVER === '1.0' ? 'shared-tags-unavailable' : 'shared-tags-unsupported')).toBeVisible();
    await expect(account.getByRole('button', { name: 'Add shared tag' })).toHaveCount(0);
    await shot(alice, 'tags-settings-unsupported');

    // The 1.0 test build drops the connection on Mailbox/get with metadata;
    // that must not leave the app reconnecting. Had the failed read reported
    // the login offline (onConnectionChange), the banner would stay until the
    // next good keep-alive ping, 30 s later. 0.16 gets no such request.
    await alice.goto('/');
    await openTeamInbox(alice);
    await alice.waitForTimeout(3000);
    await expect(alice.getByText('Connection lost. Attempting to reconnect')).toHaveCount(0);
    if (ORG_SERVER === '0.16') expect(requests).toEqual([]);
    // The 1.0 test build advertises metadata, so it was asked (and dropped it).
    if (ORG_SERVER === '1.0') expect(requests.length).toBeGreaterThan(0);
    await alice.context().close();
  });
});
