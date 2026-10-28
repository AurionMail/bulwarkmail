import { test, expect, type Page } from '@playwright/test';
import { JmapClient } from './helpers/jmap';
import { addRecipient, emailItem, setSubject } from './helpers/app';
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

/**
 * Organisation signatures and the disclaimer (organisation feature 1),
 * through the real UI on a VM 106 test server. The admin sets a locked
 * signature and a disclaimer for the example.org domain on Organisation >
 * Signatures; org-alice's mail carries both once, org-dave's (org-two.test)
 * neither; org-carol reads what arrives over JMAP. The admin's policy is
 * put back afterwards.
 */

test.describe.configure({ mode: 'serial', timeout: 240000 });

const STAMP = Date.now().toString(36);
const SIGNATURE_MARK = `Org signature ${STAMP}`;
const SIGNATURE_HTML = `<p><b>{name}</b><br>Phone: {phone}<br>Mobile: {mobile}</p><p>${SIGNATURE_MARK}</p>`;
const DISCLAIMER = `Confidential ${STAMP}: meant for the addressee only.`;
// The plain-text templates differ from the HTML ones, so a check that
// compares one against the other would add them twice.
const SIGNATURE_TEXT = `{name} | Phone {phone} | ${SIGNATURE_MARK}`;
const DISCLAIMER_HTML = `<p><i>${DISCLAIMER}</i> <a href="https://example.org/imprint">Imprint</a></p>`;
const DISCLAIMER_TEXT = `${DISCLAIMER} Imprint: https://example.org/imprint`;
const PHONE = '+49 30 5550100';

let original: Record<string, unknown>;

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

interface Received {
  html: string;
  text: string;
}

/** The message as org-carol receives it, read over JMAP. */
async function receivedByCarol(subject: string): Promise<Received> {
  const carol = await JmapClient.connect(ORG.carol, ORG_PASSWORD);
  // Matched on the exact subject: the subject filter is a word search, and
  // "Re: x" also finds "x".
  const inbox = await carol.mailboxByRole('inbox');
  let id: string | undefined;
  const deadline = Date.now() + 90000;
  while (!id) {
    const q = await carol.request([
      ['Email/query', { accountId: carol.accountId, filter: { inMailbox: inbox!.id, subject: subject.replace(/^Re: /, '') } }, '0'],
      ['Email/get', { accountId: carol.accountId, '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' }, properties: ['id', 'subject'] }, '1'],
    ]);
    id = (q.methodResponses[1][1].list as Array<{ id: string; subject: string }>).find((e) => e.subject === subject)?.id;
    if (!id) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for "${subject}" for org-carol`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const r = await carol.request([
    ['Email/get', {
      accountId: carol.accountId,
      ids: [id],
      properties: ['htmlBody', 'textBody', 'bodyValues'],
      fetchHTMLBodyValues: true,
      fetchTextBodyValues: true,
    }, '0'],
  ]);
  const email = r.methodResponses[0][1].list[0];
  const values = email.bodyValues as Record<string, { value: string }>;
  const part = (parts: Array<{ partId: string; type: string }>, type: string) =>
    parts.filter((p) => p.type === type).map((p) => values[p.partId]?.value ?? '').join('\n');
  return { html: part(email.htmlBody, 'text/html'), text: part(email.textBody, 'text/plain') };
}

/** Sends a plain mail over JMAP, for the reply test (SMTP on the test servers doesn't work). */
async function sendOverJmap(fromEmail: string, to: string, subject: string, text: string): Promise<void> {
  const from = await JmapClient.connect(fromEmail, ORG_PASSWORD);
  const identity = (await from.identities()).find((i) => i.email === fromEmail);
  const drafts = await from.mailboxByRole('drafts');
  if (!identity || !drafts) throw new Error(`No identity or Drafts for ${fromEmail}`);
  const r = await from.request([
    ['Email/set', {
      accountId: from.accountId,
      create: {
        m: {
          mailboxIds: { [drafts.id]: true },
          keywords: { $draft: true, $seen: true },
          from: [{ name: identity.name, email: identity.email }],
          to: [{ email: to }],
          subject,
          bodyValues: { t: { value: text } },
          textBody: [{ partId: 't', type: 'text/plain' }],
        },
      },
    }, '0'],
    ['EmailSubmission/set', {
      accountId: from.accountId,
      create: { s: { identityId: identity.id, emailId: '#m' } },
      onSuccessDestroyEmail: ['#s'],
    }, '1'],
  ]);
  const created = r.methodResponses[1][1].created;
  if (!created?.s) throw new Error(`Submission failed: ${JSON.stringify(r.methodResponses)}`);
}

/** Opens a new message with the Compose button (the "c" shortcut can land before the list has focus). */
async function startCompose(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Compose', exact: true }).first().click();
  await page.locator('[data-testid="email-composer"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function writeAndSend(page: Page, to: string, subject: string, text: string): Promise<void> {
  await addRecipient(page, to);
  await setSubject(page, subject);
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type(text);
  await page.locator('[data-testid="composer-send"]:visible').first().click();
  await page.locator('[data-testid="email-composer"]').waitFor({ state: 'hidden', timeout: 30000 });
}

/** org-alice fills in the phone the signature asks for, under Settings > Account. */
async function fillDetails(page: Page): Promise<void> {
  await page.goto('/settings/account');
  const phone = page.getByTestId('signature-detail-phone');
  await expect(phone).toBeVisible();
  // Let settings sync load the server's copy first: it would replace what is
  // typed. (The page never goes network-idle: push keeps a request open.)
  await page.waitForTimeout(3000);
  if ((await phone.inputValue()) !== PHONE) {
    // The next page load takes the server's copy again, so wait until the
    // details went up (the sync waits two seconds after a change).
    const synced = page.waitForResponse((res) => res.url().endsWith('/api/settings') && res.request().method() === 'POST'
      && (res.request().postData() ?? '').includes(PHONE), { timeout: 30000 });
    await phone.fill(PHONE);
    await synced;
  }
  await expect(page.getByTestId('signature-detail-title')).toHaveCount(0);
  await expect(page.getByTestId('signature-details-preview')).toContainText(PHONE);
}

test.beforeAll(async ({ browser }) => {
  requireOrgEnv();
  const admin = await adminContext(browser);
  original = await getPolicy(admin);
  await putPolicy(admin, {
    ...original,
    restrictions: {},
    organisation: {},
    scopes: [{ id: 'example-org', label: 'Example org', match: { domains: ['example.org'] }, policy: {} }],
  });
  await admin.close();
});

test.afterAll(async ({ browser }) => {
  const admin = await adminContext(browser);
  await putPolicy(admin, original);
  await admin.close();
});

test('the admin sets a locked signature and a disclaimer for example.org', async ({ browser }) => {
  const admin = await adminContext(browser);
  const page = await admin.newPage();
  await page.goto('/admin/org-signatures');
  await expect(page.getByRole('heading', { name: 'Signatures' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Example org' }).click();

  // The dev server loads the policy twice (strict mode); a fill before the
  // second load lands would be replaced, so fill until it sticks.
  await page.waitForLoadState('networkidle');
  await expect(async () => {
    await page.getByTestId('org-signature-html').fill(SIGNATURE_HTML);
    await expect(page.getByTestId('org-signature-preview')).toContainText(SIGNATURE_MARK, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByTestId('org-signature-fields').locator('[data-used]')).toHaveCount(2);
  await page.getByTestId('org-signature-text').fill(SIGNATURE_TEXT);
  await page.getByTestId('org-disclaimer-html').fill(DISCLAIMER_HTML);
  await page.getByTestId('org-disclaimer-text').fill(DISCLAIMER_TEXT);
  await page.getByLabel('Lock').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByTestId('org-signature-html').scrollIntoViewIfNeeded();
  await shot(page, 'signatures-admin-page');
  await page.getByTestId('org-disclaimer-text').scrollIntoViewIfNeeded();
  await shot(page, 'signatures-admin-disclaimer');

  const policy = await getPolicy(admin);
  const scope = (policy.scopes as Array<{ id: string; policy: Record<string, any> }>).find((s) => s.id === 'example-org')!;
  expect(scope.policy.organisation.signature).toEqual({ html: SIGNATURE_HTML, text: SIGNATURE_TEXT, fields: ['phone', 'mobile'] });
  expect(scope.policy.organisation.disclaimer).toEqual({ html: DISCLAIMER_HTML, text: DISCLAIMER_TEXT });
  expect(scope.policy.restrictions.signature).toEqual({ locked: true });
  // Everyone has no signature.
  expect((policy.organisation as Record<string, any>).signature.html).toBe('');
  await admin.close();
});

test("org-alice's new mail carries the signature and the disclaimer once", async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice);
  await fillDetails(alice);
  await shot(alice, 'signatures-user-details');

  await alice.goto('/');
  await startCompose(alice);
  await expect(alice.getByTestId('org-disclaimer-preview')).toContainText('Added when you send');
  await expect(alice.getByTestId('org-disclaimer-preview')).toContainText(DISCLAIMER);
  // The signature is an island in a shadow root; getByText looks inside it.
  const island = alice.locator('.ProseMirror .signature-block-island').first();
  await expect(island.getByText(SIGNATURE_MARK)).toBeVisible();
  await expect(island.getByText(PHONE, { exact: false })).toBeVisible();
  await shot(alice, 'signatures-composer');
  const subject = `Org signature new ${STAMP}`;
  await writeAndSend(alice, ORG.carol, subject, 'Hello Carol');

  const received = await receivedByCarol(subject);
  expect(countOf(received.html, SIGNATURE_MARK)).toBe(1);
  expect(countOf(received.text, SIGNATURE_MARK)).toBe(1);
  expect(received.html).toContain(PHONE);
  expect(received.html).not.toContain('Mobile:');
  expect(countOf(received.html, DISCLAIMER)).toBe(1);
  expect(countOf(received.text, DISCLAIMER)).toBe(1);
  // Below everything.
  expect(received.text.trimEnd().endsWith(DISCLAIMER_TEXT)).toBe(true);
  expect(received.html).toContain(`<i>${DISCLAIMER}</i>`);
  await alice.context().close();
});

test("org-alice's reply carries them once too", async ({ browser }) => {
  const subject = `Org signature question ${STAMP}`;
  await sendOverJmap(ORG.carol, ORG.alice, subject, 'A question from Carol');

  const alice = await userPage(browser, ORG.alice);
  await fillDetails(alice);
  await alice.goto('/');
  await expect(emailItem(alice, subject).first()).toBeVisible({ timeout: 60000 });
  await emailItem(alice, subject).first().click();
  await alice.keyboard.press('r');
  await alice.locator('[data-testid="email-composer"]').waitFor({ state: 'visible', timeout: 15000 });
  await alice.locator('.ProseMirror').first().click();
  await alice.keyboard.type('The answer');
  await alice.locator('[data-testid="composer-send"]:visible').first().click();
  await alice.locator('[data-testid="email-composer"]').waitFor({ state: 'hidden', timeout: 30000 });

  const received = await receivedByCarol(`Re: ${subject}`);
  expect(received.text).toContain('A question from Carol');
  expect(countOf(received.html, SIGNATURE_MARK)).toBe(1);
  expect(countOf(received.text, SIGNATURE_MARK)).toBe(1);
  expect(countOf(received.html, DISCLAIMER)).toBe(1);
  expect(countOf(received.text, DISCLAIMER)).toBe(1);
  // The disclaimer comes after the quote.
  expect(received.text.indexOf('A question from Carol')).toBeLessThan(received.text.indexOf(DISCLAIMER));
  await alice.context().close();
});

test("the locked editor says it's set by the organisation", async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice);
  await fillDetails(alice);
  await alice.getByRole('button', { name: 'Manage' }).first().click();
  await alice.getByRole('button', { name: 'Edit Identity' }).first().click();
  const locked = alice.getByTestId('identity-locked-signature');
  await expect(locked).toContainText(SIGNATURE_MARK);
  await expect(locked).toContainText(PHONE);
  await expect(locked).toContainText('Set by your organisation');
  await expect(alice.locator('#identity-html-sig')).toHaveCount(0);
  await shot(alice, 'signatures-identity-locked');
  await alice.context().close();
});

test("org-dave's mail from another domain gets neither", async ({ browser }) => {
  const dave = await userPage(browser, ORG.dave);
  await startCompose(dave);
  await expect(dave.getByTestId('org-disclaimer-preview')).toHaveCount(0);
  const subject = `Org signature dave ${STAMP}`;
  await writeAndSend(dave, ORG.carol, subject, 'Hello from org-two');

  const received = await receivedByCarol(subject);
  expect(received.text).toContain('Hello from org-two');
  expect(received.html + received.text).not.toContain(SIGNATURE_MARK);
  expect(received.html + received.text).not.toContain(DISCLAIMER);
  await dave.context().close();
});

test('the composer, the details and the admin page work at phone width', async ({ browser }) => {
  const alice = await userPage(browser, ORG.alice, true);
  await alice.goto('/settings/account');
  await alice.getByRole('button', { name: 'Account' }).or(alice.getByRole('link', { name: 'Account' })).first().click();
  const phone = alice.getByTestId('signature-detail-phone');
  await phone.scrollIntoViewIfNeeded();
  await phone.fill(PHONE);
  const box = await phone.boundingBox();
  // One column: the input spans the width.
  expect(box!.width).toBeGreaterThan(300);
  await shot(alice, 'signatures-user-details-phone');

  await alice.goto('/');
  await startCompose(alice);
  const preview = alice.getByTestId('org-disclaimer-preview');
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toContainText(DISCLAIMER);
  const overflow = await alice.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const previewBox = await preview.boundingBox();
  expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(390);
  await shot(alice, 'signatures-composer-phone');
  await alice.context().close();

  const admin = await adminContext(browser, true);
  const page = await admin.newPage();
  await page.goto('/admin/org-signatures');
  await expect(page.getByTestId('org-signature-html')).toBeVisible();
  const adminOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(adminOverflow).toBeLessThanOrEqual(0);
  await shot(page, 'signatures-admin-page-phone');
  await admin.close();
});
