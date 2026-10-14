import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import type { IJMAPClient } from '../jmap/client-interface';
import { useAuthStore } from '@/stores/auth-store';
import { useIdentityStore } from '@/stores/identity-store';
import { INTERNAL_MAILTO_EVENT, type ParsedMailto } from '../protocol-handlers/mailto';
import { consumePendingMailto } from '../protocol-handlers/session';
import { resetPluginRateLimits } from '../plugin-sandbox/host-api-input';
import { HIGH_RISK_PERMISSIONS } from '../plugin-sandbox/permission-text';
import { ALL_PERMISSIONS } from '../plugin-types';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(perms: string[], id = 'cloud'): InstalledPlugin {
  return {
    id, name: 'Cloud', version: '1.0.0', author: 'test', description: '',
    type: 'hook', permissions: perms, grantedPermissions: perms, entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
}

const COMPOSER = plugin(['compose:open']);
const DRAFTER = plugin(['email:write']);
const call = (p: InstalledPlugin, method: string, ...args: unknown[]) => dispatchApiCall(p, method, args);
const pdf = { blobId: 'b1', name: 'report.pdf', type: 'application/pdf', size: 1200 };

describe('api.compose.open', () => {
  let taken: ParsedMailto[];
  const listener = (event: Event) => {
    event.preventDefault();
    taken.push((event as CustomEvent<ParsedMailto>).detail);
  };

  beforeEach(() => {
    taken = [];
    resetPluginRateLimits();
    window.addEventListener(INTERNAL_MAILTO_EVENT, listener);
  });
  afterEach(() => {
    window.removeEventListener(INTERNAL_MAILTO_EVENT, listener);
    sessionStorage.clear();
  });

  it('hands the mail page a filled-in draft, like an in-app mailto: link', async () => {
    expect(await call(COMPOSER, 'compose.open', {
      to: ['Bob <bob@example.com>'], cc: ['carol@example.com'], subject: 'Report', body: 'See attached', attachments: [pdf],
    })).toBe('opened');
    expect(taken).toEqual([{
      to: ['Bob <bob@example.com>'], cc: ['carol@example.com'], bcc: [], subject: 'Report', body: 'See attached', attachments: [pdf],
      // onMailtoIntercept sees a mailto: URL for it too.
      href: expect.stringMatching(/^mailto:/),
    }]);
  });

  it('sanitises an HTML body and sends it as htmlBody', async () => {
    await call(COMPOSER, 'compose.open', { body: '<p>Hi <b>there</b></p><img src=x onerror="steal()">', isHtml: true });
    expect(taken[0].htmlBody).toContain('<b>there</b>');
    expect(taken[0].htmlBody).not.toContain('onerror');
    expect(taken[0].body).toMatch(/Hi there/);
  });

  it('parks the draft for the mail page when none is on screen', async () => {
    window.removeEventListener(INTERNAL_MAILTO_EVENT, listener);
    // jsdom does not navigate; the call still reports where it is going.
    expect(await call(COMPOSER, 'compose.open', { to: ['bob@example.com'], subject: 'Hi' })).toBe('navigating');
    expect(consumePendingMailto()).toEqual(expect.objectContaining({ to: ['bob@example.com'], subject: 'Hi' }));
  });

  it('refuses bad addresses, header injection, too many recipients and odd attachments', async () => {
    await expect(call(COMPOSER, 'compose.open', { to: ['nobody'] })).rejects.toThrow(/to\[0\] is not a valid address/);
    await expect(call(COMPOSER, 'compose.open', { subject: 'Hi\r\nBcc: x@example.com' })).rejects.toThrow(/subject must be one line/);
    const many = Array.from({ length: 101 }, (_, i) => `u${i}@example.com`);
    await expect(call(COMPOSER, 'compose.open', { to: many })).rejects.toThrow(/at most 100 addresses/);
    await expect(call(COMPOSER, 'compose.open', { to: many.slice(0, 60), cc: many.slice(60) })).rejects.toThrow(/at most 100 recipients in all/);
    await expect(call(COMPOSER, 'compose.open', { attachments: [{ ...pdf, type: 'not a type' }] })).rejects.toThrow(/not a media type/);
    await expect(call(COMPOSER, 'compose.open', { from: 'boss@example.com' })).rejects.toThrow(/unknown property "from"/);
    expect(taken).toEqual([]);
  });

  it('opens at most five times a minute per plugin', async () => {
    for (let i = 0; i < 5; i++) await call(COMPOSER, 'compose.open', {});
    await expect(call(COMPOSER, 'compose.open', {})).rejects.toThrow(/at most 5 times a minute/);
    expect(await call(plugin(['compose:open'], 'other'), 'compose.open', {})).toBe('opened');
    expect(taken).toHaveLength(6);
  });

  it('needs compose:open, a new permission that is not marked high risk', async () => {
    await expect(call(plugin(['email:send']), 'compose.open', {})).rejects.toThrow(/lacks permission "compose:open"/);
    expect(taken).toEqual([]);
    expect(ALL_PERMISSIONS).toContain('compose:open');
    expect(HIGH_RISK_PERMISSIONS.has('compose:open')).toBe(false);
  });
});

describe('api.drafts.create', () => {
  let createDraft: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPluginRateLimits();
    createDraft = vi.fn(async () => 'draft-1');
    useAuthStore.setState({ client: { createDraft } as unknown as IJMAPClient });
    useIdentityStore.setState({
      identities: [
        { id: 'id-a', name: 'Ann', email: 'ann@example.com' },
        { id: 'id-b', name: 'Ann Work', email: 'ann@work.example' },
      ] as never,
      preferredPrimaryId: 'id-b',
    });
  });
  afterEach(() => {
    useAuthStore.setState({ client: null });
    useIdentityStore.setState({ identities: [], preferredPrimaryId: null });
  });

  it('saves a draft from the default identity and returns its id', async () => {
    expect(await call(DRAFTER, 'drafts.create', {
      to: ['bob@example.com'], subject: 'Notes', body: '<p>Hello</p><script>x()</script>', isHtml: true, attachments: [pdf],
    })).toBe('draft-1');
    const [to, subject, text, cc, bcc, identityId, fromEmail, draftId, attachments, fromName, html] = createDraft.mock.calls[0];
    expect({ to, subject, cc, bcc, identityId, fromEmail, draftId, fromName }).toEqual({
      to: ['bob@example.com'], subject: 'Notes', cc: [], bcc: [], identityId: 'id-b',
      fromEmail: 'ann@work.example', draftId: undefined, fromName: 'Ann Work',
    });
    expect(text).toMatch(/Hello/);
    expect(html).toContain('<p>Hello</p>');
    expect(html).not.toContain('script');
    expect(attachments).toEqual([{ ...pdf, disposition: 'attachment' }]);
  });

  it('needs email:write and valid input', async () => {
    await expect(call(plugin(['compose:open']), 'drafts.create', {})).rejects.toThrow(/lacks permission "email:write"/);
    await expect(call(DRAFTER, 'drafts.create', { to: 'bob@example.com' })).rejects.toThrow(/to must be an array/);
    await expect(call(DRAFTER, 'drafts.create', { attachments: [{ blobId: 'b1' }] })).rejects.toThrow(/attachments\[0\]\.type must be a string/);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('saves at most ten drafts a minute', async () => {
    for (let i = 0; i < 10; i++) await call(DRAFTER, 'drafts.create', {});
    await expect(call(DRAFTER, 'drafts.create', {})).rejects.toThrow(/at most 10 drafts a minute/);
    expect(createDraft).toHaveBeenCalledTimes(10);
  });
});
