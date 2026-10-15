import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { InstalledPlugin, Permission } from '../plugin-types';

// Hooks and slots used to be wired for whatever the sandbox reported, with
// no look at the manifest: a plugin declaring no permissions could add a
// Bcc to every outgoing mail through onTransformOutgoingEmail and read every
// opened message through onRenderEmailBody.

const mocks = vi.hoisted(() => ({
  background: { hooks: [] as string[], slots: [] as Array<{ name: string }> },
  invokeHook: null as null | ((name: string, args: unknown[]) => Promise<unknown>),
}));

const CODE = 'export default { activate() {} }';
const HASH = createHash('sha256').update(CODE, 'utf-8').digest('hex');

vi.mock('../plugin-storage', () => ({
  pluginStorage: { getCode: async () => CODE, saveCode: async () => {}, deleteCode: vi.fn() },
}));
vi.mock('../plugin-sandbox/bundle-fetch', () => ({ downloadManagedBundle: vi.fn() }));
vi.mock('../plugin-sandbox/host-bridge', () => ({
  createBackgroundInstance: () => {
    const invokeHook = vi.fn(async () => ({ to: ['a@example.org'], bcc: ['attacker@evil.example'] }));
    mocks.invokeHook = invokeHook;
    return {
      initPromise: Promise.resolve({ hooks: mocks.background.hooks, slots: mocks.background.slots, shortcuts: [] }),
      invokeHook,
      destroy: vi.fn(),
    };
  },
  SandboxInstance: class {},
}));
vi.mock('../plugin-sandbox/host-api', () => ({ cancelPluginDialogs: vi.fn() }));
vi.mock('../plugin-sandbox/shortcuts', () => ({ registerShortcuts: () => () => {} }));

import { loadSandboxedPlugin, unloadSandboxedPlugin, setSandboxStoreAccessor } from '../plugin-sandbox/loader';
import { get as getActive } from '../plugin-sandbox/registry';
import { emailHooks, renderHooks, appLifecycleHooks } from '../plugin-hooks';
import { hookPermission, mayOfferSlot, mayRegisterHook, pluginHasPermission } from '../plugin-sandbox/permissions';
import { useEmailStore } from '@/stores/email-store';
import type { Email } from '../jmap/types';

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'hook-plugin',
    name: 'Hook plugin',
    version: '1.0.0',
    author: 'someone',
    description: '',
    type: 'hook',
    permissions: [],
    entrypoint: 'index.js',
    enabled: true,
    status: 'enabled',
    settings: {},
    managed: true,
    adminApproved: true,
    bundleHash: HASH,
    ...overrides,
  };
}

beforeEach(() => {
  setSandboxStoreAccessor({ setPluginStatus: () => {} });
  mocks.background.hooks = ['onTransformOutgoingEmail', 'onRenderEmailBody', 'onAppReady'];
  mocks.background.slots = [{ name: 'email-banner' }, { name: 'plugin-dialog' }];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  unloadSandboxedPlugin('hook-plugin');
  vi.restoreAllMocks();
});

describe('sandboxed plugin hooks and slots', () => {
  it('a zero-permission plugin cannot rewrite outgoing mail or read opened messages', async () => {
    await loadSandboxedPlugin(plugin());

    expect(emailHooks.onTransformOutgoingEmail.size).toBe(0);
    expect(renderHooks.onRenderEmailBody.size).toBe(0);
    const outgoing = await emailHooks.onTransformOutgoingEmail.transform({ to: ['a@example.org'], bcc: [] });
    expect(outgoing).toEqual({ to: ['a@example.org'], bcc: [] });

    // Implicit permissions still work.
    expect(appLifecycleHooks.onAppReady.size).toBe(1);
    expect(getActive('hook-plugin')?.slotOffers.map((o) => o.name)).toEqual(['plugin-dialog']);
  });

  it('wires the hooks and slots a managed plugin declares', async () => {
    await loadSandboxedPlugin(plugin({ permissions: ['email:send', 'email:render-takeover', 'ui:email-banner'] }));

    expect(emailHooks.onTransformOutgoingEmail.size).toBe(1);
    expect(renderHooks.onRenderEmailBody.size).toBe(1);
    expect(getActive('hook-plugin')?.slotOffers.map((o) => o.name)).toEqual(['email-banner', 'plugin-dialog']);
  });

  it('holds back a declared permission the user has not granted', async () => {
    await loadSandboxedPlugin(plugin({
      managed: false,
      permissions: ['email:send', 'email:render-takeover'],
      grantedPermissions: ['email:render-takeover'],
    }));

    expect(emailHooks.onTransformOutgoingEmail.size).toBe(0);
    expect(renderHooks.onRenderEmailBody.size).toBe(1);
  });
});

describe('a message that is already open', () => {
  const open = { id: 'm1', threadId: 't1', subject: 'Your parcel', from: [{ name: 'Shop', email: 'shop@example.org' }], to: [], receivedAt: '2026-10-14T10:00:00Z', keywords: {}, mailboxIds: {} } as unknown as Email;

  afterEach(() => { useEmailStore.setState({ selectedEmail: null }); });

  it('reaches a plugin that starts after it was opened', async () => {
    useEmailStore.setState({ selectedEmail: open });
    mocks.background.hooks = ['onEmailOpen'];
    await loadSandboxedPlugin(plugin({ permissions: ['email:read'] }));

    const calls = (mocks.invokeHook as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === 'onEmailOpen');
    expect(calls).toHaveLength(1);
    expect(calls[0][1][0]).toMatchObject({ id: 'm1', subject: 'Your parcel' });
  });

  it('is not handed to a plugin without the permission, nor when nothing is open', async () => {
    mocks.background.hooks = ['onEmailOpen'];
    useEmailStore.setState({ selectedEmail: open });
    await loadSandboxedPlugin(plugin());
    expect((mocks.invokeHook as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    unloadSandboxedPlugin('hook-plugin');

    useEmailStore.setState({ selectedEmail: null });
    await loadSandboxedPlugin(plugin({ permissions: ['email:read'] }));
    expect((mocks.invokeHook as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe('permission tables', () => {
  it('refuses a hook it does not know', () => {
    expect(hookPermission('onSomethingNew')).toBeNull();
    expect(mayRegisterHook(plugin({ permissions: ['email:read'] }), 'onSomethingNew')).toBe(false);
    expect(hookPermission('toString')).toBeNull();
  });

  it('refuses a slot it does not know', () => {
    expect(mayOfferSlot(plugin({ permissions: ['ui:toolbar'] }), 'made-up-slot')).toBe(false);
    expect(mayOfferSlot(plugin({ permissions: ['ui:toolbar'] }), 'constructor')).toBe(false);
  });

  it('accepts either permission for the admin page slot', () => {
    expect(mayOfferSlot(plugin({ permissions: ['admin:config'] }), 'admin-plugin-page')).toBe(true);
    expect(mayOfferSlot(plugin({ permissions: ['ui:admin-page'] }), 'admin-plugin-page')).toBe(true);
    expect(mayOfferSlot(plugin({ permissions: [] }), 'admin-plugin-page')).toBe(false);
  });

  it('treats implicit permissions as granted', () => {
    expect(pluginHasPermission(plugin({ managed: false }), 'app:lifecycle' as Permission)).toBe(true);
    expect(mayRegisterHook(plugin(), 'onAfterLogout')).toBe(true);
  });
});
