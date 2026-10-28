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
import { folderRow } from './helpers/app';

/**
 * Recover deleted items (organisation feature 9, #1319) through the real UI
 * on a VM 106 test server.
 *
 * No test server has a Stalwart Enterprise license yet, so x:ArchivedItem
 * answers `forbidden` everywhere and the feature has to hide itself: Bulwark
 * asks once, then shows no Settings entry and no Trash link. An admin scope
 * that hides `deletedItemsRecovery` keeps Bulwark from asking at all.
 *
 * The licensed case (IT_RECOVERY_LICENSED=1, on a server with a license and
 * `archiveDeletedItemsFor` set): org-alice deletes a message for good, finds
 * it under Settings > Recover deleted items, restores it, and it is back in
 * her Inbox over JMAP. The admin's policy is put back at the end.
 */

// Sign-ins and first compiles of a dev server take a while.
test.describe.configure({ mode: 'serial', timeout: 180000 });

const LICENSED = process.env.IT_RECOVERY_LICENSED === '1';
const STALWART_USING = ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'];

let original: Record<string, unknown>;
let alice: JmapClient;

const isArchiveQuery = (body: string | null) => !!body && body.includes('x:ArchivedItem/query');

/** Collects the bodies of the JMAP requests the page sends that ask the archive. */
function watchArchiveQueries(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const body = request.postData();
    if (request.method() === 'POST' && isArchiveQuery(body)) seen.push(body!);
  });
  return seen;
}

async function openTrash(page: Page): Promise<void> {
  const trash = folderRow(page, { role: 'trash', shared: false }).first();
  await expect(trash).toBeVisible({ timeout: 30000 });
  await trash.click();
}

async function setPolicy(browser: import('@playwright/test').Browser, patch: Record<string, unknown>): Promise<void> {
  const admin = await adminContext(browser);
  await putPolicy(admin, { ...original, scopes: [], restrictions: {}, features: {}, ...patch });
  await admin.close();
}

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await admin.close();
  await setPolicy(browser, {});
  alice = await JmapClient.connect(ORG.alice, ORG_PASSWORD);
});

test.afterAll(async ({ browser }) => {
  if (!original) return;
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
});

test.describe('without an Enterprise license', () => {
  test.skip(LICENSED, 'the server has a license (IT_RECOVERY_LICENSED=1)');

  test('the server refuses x:ArchivedItem/query', async () => {
    const r = await alice.request([['x:ArchivedItem/query', { accountId: alice.accountId }, 'q']], STALWART_USING);
    expect(r.methodResponses[0][0]).toBe('error');
    expect(r.methodResponses[0][1]).toMatchObject({ type: 'forbidden' });
  });

  test('Bulwark asks once, then shows no Trash link and no Settings entry', async ({ browser }) => {
    const page = await userPage(browser, ORG.alice);
    const asked = watchArchiveQueries(page);
    const answer = page.waitForResponse((res) => isArchiveQuery(res.request().postData()), { timeout: 30000 });
    await openTrash(page);
    await answer;
    await expect(page.getByTestId('trash-recovery-link')).toHaveCount(0);
    await shot(page, 'recovery-trash-hidden');

    await page.goto('/settings/recovery');
    await expect(page.getByRole('heading', { name: 'Appearance' }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Recover deleted items' }).or(page.getByRole('link', { name: 'Recover deleted items' }))).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recover deleted items' })).toHaveCount(0);
    await expect(page.getByTestId('recover-deleted-list')).toHaveCount(0);
    // One question per account and session, not one per page.
    expect(asked.length).toBe(1);
    await page.context().close();
  });

  test('the same at phone width', async ({ browser }) => {
    const page = await userPage(browser, ORG.carol, true);
    const answer = page.waitForResponse((res) => isArchiveQuery(res.request().postData()), { timeout: 30000 });
    await page.goto('/settings/recovery');
    await answer;
    await expect(page.getByRole('button', { name: 'Recover deleted items' }).or(page.getByRole('link', { name: 'Recover deleted items' }))).toHaveCount(0);
    await shot(page, 'recovery-settings-hidden-phone');
    await page.context().close();
  });
});

test('the admin hides it for a group and limits the days for a domain on Organisation > Sharing', async ({ browser }) => {
  const admin = await adminContext(browser);
  await putPolicy(admin, {
    ...original,
    restrictions: {}, features: {},
    scopes: [
      { id: 'recovery-team', label: 'Org team', match: { groups: [ORG.team] }, policy: {} },
      { id: 'recovery-example', label: 'Example', match: { domains: ['example.org'] }, policy: {} },
    ],
  });
  const page = await admin.newPage();
  await page.goto('/admin/org-sharing');
  const section = page.locator('[data-settings-section="recovery"]');
  await expect(section.getByRole('heading', { name: 'Recover deleted items' })).toBeVisible({ timeout: 30000 });
  await expect(section.getByTestId('org-recovery-requirements')).toContainText('Stalwart Enterprise license');
  const scopeBar = page.getByTestId('org-scope-bar');
  await scopeBar.getByRole('button', { name: 'Example', exact: true }).click();
  await section.getByLabel('Show deleted mail of the last (days)').fill('14');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await scopeBar.getByRole('button', { name: 'Org team', exact: true }).click();
  await section.getByLabel('Hide', { exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await shot(page, 'recovery-admin');

  const saved = await getPolicy(admin);
  const scopes = saved.scopes as Array<{ id: string; policy: { restrictions?: Record<string, unknown>; organisation?: Record<string, unknown> } }>;
  expect(scopes.find((s) => s.id === 'recovery-team')!.policy.restrictions).toEqual({ deletedItemsRecovery: { hidden: true } });
  expect(scopes.find((s) => s.id === 'recovery-example')!.policy.organisation).toEqual({ recovery: { days: 14 } });
  await page.close();

  const phone = await adminContext(browser, true);
  const phonePage = await phone.newPage();
  await phonePage.goto('/admin/org-sharing');
  const phoneSection = phonePage.locator('[data-settings-section="recovery"]');
  await phoneSection.scrollIntoViewIfNeeded();
  await expect(phoneSection.getByLabel('Show deleted mail of the last (days)')).toBeVisible({ timeout: 30000 });
  const width = await phonePage.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await shot(phonePage, 'recovery-admin-phone');
  await phone.close();
  await admin.close();
});

test('a member of the hidden group gets nothing and Bulwark never asks the server', async ({ browser }) => {
  const page = await userPage(browser, ORG.alice);
  const asked = watchArchiveQueries(page);
  await openTrash(page);
  await page.goto('/settings/recovery');
  await expect(page.getByRole('heading', { name: 'Appearance' }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Recover deleted items' }).or(page.getByRole('link', { name: 'Recover deleted items' }))).toHaveCount(0);
  expect(asked).toEqual([]);
  await page.context().close();
});

test('someone outside the group is still asked about', async ({ browser }) => {
  // carol is in example.org but not in the group: Bulwark asks the server for her.
  const page = await userPage(browser, ORG.carol);
  const answer = page.waitForResponse((res) => isArchiveQuery(res.request().postData()), { timeout: 30000 });
  await openTrash(page);
  await answer;
  if (!LICENSED) await expect(page.getByTestId('trash-recovery-link')).toHaveCount(0);
  else await expect(page.getByTestId('trash-recovery-link')).toBeVisible();
  await page.context().close();
});

/**
 * The page with archive answers put in by the browser test, not a server:
 * DERIVED from the Stalwart source (x:ArchivedItem in
 * crates/jmap/src/registry/mapping/archived_item.rs, ArchivedEmail in
 * crates/registry/src/schema/structs_impl.rs), because no server can give
 * them yet. Every other request goes to the real server. Restoring `b` is
 * refused, to show the partial failure.
 */
type ArchiveMode = 'items' | 'empty' | 'getFails';

async function answerArchiveCalls(page: Page, mode: () => ArchiveMode): Promise<string[]> {
  const restored: string[] = [];
  const day = 24 * 60 * 60_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const now = Date.now();
  const items: Record<string, Record<string, unknown>> = {
    a: { from: 'Org Bob <org-bob@example.org>', subject: 'Signed contract', archivedAt: iso(now - 2 * 60 * 60_000) },
    b: { from: 'billing@supplier.example', subject: 'Invoice 2026-118', archivedAt: iso(now - 3 * day) },
    c: { from: 'Org Carol', subject: 'Team offsite plan', archivedAt: iso(now - 9 * day) },
  };
  await page.route('**/*', async (route) => {
    const body = route.request().postData();
    if (route.request().method() !== 'POST' || !body || !body.includes('"x:ArchivedItem/')) return route.fallback();
    const request = JSON.parse(body) as { methodCalls: Array<[string, Record<string, unknown>, string]> };
    const methodResponses = request.methodCalls.map(([method, args, id]) => {
      const accountId = args.accountId;
      if (method === 'x:ArchivedItem/query') {
        // A user without Impersonate is refused the accountId filter.
        if (args.filter) return ['error', { type: 'unsupportedFilter', description: 'Filter on property accountId is not supported or invalid' }, id];
        // Newest first, as Stalwart's growing registry ids give it.
        const all = mode() === 'empty' ? [] : Object.keys(items).sort((x, y) => Date.parse(items[y].archivedAt as string) - Date.parse(items[x].archivedAt as string));
        const position = (args.position as number | undefined) ?? 0;
        const ids = all.slice(position, position + ((args.limit as number | undefined) ?? 5000));
        return [method, { accountId, ids, position, ...(args.calculateTotal ? { total: all.length } : {}), queryState: 's0', canCalculateChanges: false }, id];
      }
      if (method === 'x:ArchivedItem/get') {
        if (mode() === 'getFails') return ['error', { type: 'serverFail', description: 'Synthetic failure' }, id];
        const list = (args.ids as string[]).filter((i) => items[i]).map((i) => ({
          id: i, '@type': 'Email', receivedAt: iso(now - 30 * day), size: 4096, accountId,
          archivedUntil: iso(now + 20 * day), blobId: `blob-${i}`, ...items[i],
        }));
        return [method, { accountId, list, notFound: [] }, id];
      }
      if (method === 'x:ArchivedItem/set') {
        const ids = Object.keys(args.update as object);
        const ok = ids.filter((i) => i !== 'b');
        restored.push(...ok);
        for (const i of ok) delete items[i];
        return [method, {
          accountId, updated: Object.fromEntries(ok.map((i) => [i, null])),
          notUpdated: ids.includes('b') ? { b: { type: 'serverFail', description: 'Synthetic refusal' } } : {},
        }, id];
      }
      return ['error', { type: 'unknownMethod' }, id];
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ methodResponses, sessionState: 's' }) });
  });
  return restored;
}

test.describe('the page with derived archive answers (no server has a license yet)', () => {
  test.beforeAll(async ({ browser }) => {
    await setPolicy(browser, {});
  });

  test('Trash links to the list; restoring shows what failed and keeps it selected', async ({ browser }) => {
    const page = await userPage(browser, ORG.alice);
    let mode: ArchiveMode = 'items';
    const restored = await answerArchiveCalls(page, () => mode);
    await openTrash(page);
    const link = page.getByTestId('trash-recovery-link');
    await expect(link).toBeVisible({ timeout: 30000 });
    await shot(page, 'recovery-trash-link');
    await link.getByRole('button', { name: 'Recover deleted items' }).click();
    await expect(page.getByRole('heading', { name: 'Recover deleted items' }).first()).toBeVisible({ timeout: 30000 });
    const rows = page.getByTestId('recover-deleted-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Signed contract');
    await expect(rows.nth(0)).toContainText('Org Bob');
    await expect(rows.nth(2)).toContainText('Team offsite plan');
    await shot(page, 'recovery-list');

    await page.getByTestId('recover-deleted-select-all').check();
    await page.getByTestId('recover-deleted-restore').click();
    await expect(page.getByTestId('recover-deleted-partial')).toContainText("1 message couldn't be restored");
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('Invoice 2026-118');
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
    expect(restored.sort()).toEqual(['a', 'c']);
    await shot(page, 'recovery-partial');

    mode = 'getFails';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByTestId('recover-deleted-error')).toBeVisible();
    await shot(page, 'recovery-error');
    mode = 'empty';
    await page.getByTestId('recover-deleted-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('recover-deleted-empty')).toContainText('archiving of deleted items');
    await shot(page, 'recovery-empty');
    // With nothing to recover, Trash has no link (the page itself stays in Settings).
    await page.goto('/');
    const looked = page.waitForRequest((req) => (req.postData() ?? '').includes('"calculateTotal":true'), { timeout: 30000 });
    await openTrash(page);
    await looked;
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('trash-recovery-link')).toHaveCount(0);
    await page.context().close();
  });

  test('the list fits a phone and the days of a domain scope apply', async ({ browser }) => {
    await setPolicy(browser, { scopes: [{ id: 'recovery-example', label: 'Example', match: { domains: ['example.org'] }, policy: { organisation: { recovery: { days: 7 } } } }] });
    const page = await userPage(browser, ORG.alice, true);
    await answerArchiveCalls(page, () => 'items');
    await page.goto('/settings/recovery');
    await page.getByRole('button', { name: 'Recover deleted items' }).or(page.getByRole('link', { name: 'Recover deleted items' })).first().click({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Recover deleted items' }).first()).toBeVisible({ timeout: 30000 });
    // c was deleted nine days ago: outside the domain's seven days.
    await expect(page.getByTestId('recover-deleted-row')).toHaveCount(2);
    await expect(page.getByTestId('recover-deleted-range')).toHaveText('Showing mail deleted in the last 7 days.');
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'recovery-list-phone');
    await page.context().close();
  });
});

test.describe('with an Enterprise license', () => {
  test.skip(!LICENSED, 'set IT_RECOVERY_LICENSED=1 on a server with a license and archiveDeletedItemsFor');

  test('alice deletes a message for good, finds it under Recover deleted items and restores it to her Inbox', async ({ browser }) => {
    await setPolicy(browser, {});
    const subject = `Recovery ${Date.now()}`;
    const inbox = (await alice.mailboxByRole('inbox'))!;
    const created = await alice.request([
      ['Email/set', {
        accountId: alice.accountId,
        create: {
          m: {
            mailboxIds: { [inbox.id]: true },
            keywords: { $seen: true },
            from: [{ name: 'Org Bob', email: ORG.bob }],
            to: [{ email: ORG.alice }],
            subject,
            bodyValues: { b: { value: 'Please bring this back.' } },
            textBody: [{ partId: 'b', type: 'text/plain' }],
          },
        },
      }, '0'],
    ]);
    const emailId = created.methodResponses[0][1].created.m.id as string;
    // Deleted for good, as emptying Trash does.
    await alice.request([['Email/set', { accountId: alice.accountId, destroy: [emailId] }, '0']]);
    expect(await alice.findEmailBySubject(subject)).toBeUndefined();

    const page = await userPage(browser, ORG.alice);
    // The Trash link only shows once the archive holds the message; the page is there at once.
    await page.goto('/settings/recovery');
    await expect(page.getByRole('heading', { name: 'Recover deleted items' }).first()).toBeVisible({ timeout: 30000 });
    // The server archives in the background: refresh until the message is there.
    const row = page.getByTestId('recover-deleted-row').filter({ hasText: subject });
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(row).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 90000 });
    await expect(row).toContainText('Org Bob');
    await shot(page, 'recovery-list-licensed');

    await row.getByRole('checkbox').check();
    await page.getByTestId('recover-deleted-restore').click();
    await expect(page.getByTestId('recover-deleted-status')).toContainText('on the way back to your Inbox');
    await expect(row).toHaveCount(0);

    const restored = await alice.waitForEmail(subject, { mailboxId: inbox.id, timeoutMs: 90000 });
    expect(restored.keywords?.$seen).toBeFalsy();
    await alice.request([['Email/set', { accountId: alice.accountId, destroy: [restored.id] }, '0']]);
    await page.context().close();
  });

  test('the list and restore work at phone width', async ({ browser }) => {
    const page = await userPage(browser, ORG.alice, true);
    await page.goto('/settings/recovery');
    await page.getByRole('button', { name: 'Recover deleted items' }).or(page.getByRole('link', { name: 'Recover deleted items' })).first().click();
    await expect(page.getByRole('heading', { name: 'Recover deleted items' }).first()).toBeVisible({ timeout: 30000 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'recovery-list-phone-licensed');
    await page.context().close();
  });
});
