import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { InstalledPlugin } from '../plugin-types';

// Copies of the external-mail-warning plugin older than the release that
// steps back on its own keep their send check. While the organisation's
// own warnings are on, the host skips that plugin's hooks by id, so the
// user isn't asked twice; other plugins keep theirs.

const mocks = vi.hoisted(() => ({
  hooks: [] as string[],
  invokeHook: null as null | ReturnType<typeof vi.fn>,
}));

const CODE = 'export default { activate() {} }';
const HASH = createHash('sha256').update(CODE, 'utf-8').digest('hex');

vi.mock('../plugin-storage', () => ({
  pluginStorage: { getCode: async () => CODE, saveCode: async () => {}, deleteCode: vi.fn() },
}));
vi.mock('../plugin-sandbox/bundle-fetch', () => ({ downloadManagedBundle: vi.fn() }));
vi.mock('../plugin-sandbox/host-bridge', () => ({
  createBackgroundInstance: () => {
    // The old plugin's check: "Send to external recipients?" answered with Cancel.
    const invokeHook = vi.fn(async () => false);
    mocks.invokeHook = invokeHook;
    return {
      initPromise: Promise.resolve({ hooks: mocks.hooks, slots: [], shortcuts: [] }),
      invokeHook,
      destroy: vi.fn(),
    };
  },
  snapshotRegionalSettings: vi.fn((locale: string) => ({ locale, dateLocale: locale, hour12: false, timeZone: 'UTC', firstDayOfWeek: 1 })),
  forEachInstance: vi.fn(),
  SandboxInstance: class {},
}));
vi.mock('../plugin-sandbox/host-api', () => ({ cancelPluginDialogs: vi.fn() }));
vi.mock('../plugin-sandbox/shortcuts', () => ({ registerShortcuts: () => () => {} }));

import { loadSandboxedPlugin, unloadSandboxedPlugin, setSandboxStoreAccessor } from '../plugin-sandbox/loader';
import { emailHooks } from '../plugin-hooks';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';

function plugin(id: string): InstalledPlugin {
  return {
    id, name: id, version: '1.5.1', author: 'someone', description: '', type: 'hook',
    permissions: ['email:send', 'email:read'], entrypoint: 'index.js', enabled: true, status: 'enabled',
    settings: {}, managed: true, adminApproved: true, bundleHash: HASH,
  };
}

function setExternalMail(patch: Partial<typeof DEFAULT_ORGANISATION_POLICY.externalMail>) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, ...patch } },
    },
  });
}

const OUTGOING = { to: ['dave@org-two.test'], cc: [], bcc: [], subject: 'Hi' };
let loaded: string | null = null;

beforeEach(() => {
  setSandboxStoreAccessor({ setPluginStatus: () => {} });
  mocks.hooks = ['onBeforeEmailSend', 'onNewEmailReceived'];
  setExternalMail({});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  if (loaded) unloadSandboxedPlugin(loaded);
  loaded = null;
  vi.restoreAllMocks();
});

describe('the retired external-mail-warning plugin', () => {
  it('asks as before while the core warnings are off', async () => {
    loaded = 'external-mail-warning';
    await loadSandboxedPlugin(plugin(loaded));
    expect(await emailHooks.onBeforeEmailSend.interceptOutcome(OUTGOING as never)).toBe('vetoed');
    expect(mocks.invokeHook).toHaveBeenCalledWith('onBeforeEmailSend', [OUTGOING]);
  });

  it('is skipped while the core warnings are on, and asked again once they are off', async () => {
    loaded = 'external-mail-warning';
    await loadSandboxedPlugin(plugin(loaded));
    setExternalMail({ senderLabel: true });
    expect(await emailHooks.onBeforeEmailSend.interceptOutcome(OUTGOING as never)).toBe('allowed');
    await emailHooks.onNewEmailReceived.emit({ from: [{ email: 'dave@org-two.test' }] } as never);
    expect(mocks.invokeHook).not.toHaveBeenCalled();

    setExternalMail({});
    expect(await emailHooks.onBeforeEmailSend.interceptOutcome(OUTGOING as never)).toBe('vetoed');
  });

  it('leaves the send checks of other plugins alone', async () => {
    loaded = 'reply-all-guardrail';
    await loadSandboxedPlugin(plugin(loaded));
    setExternalMail({ recipientWarning: true });
    expect(await emailHooks.onBeforeEmailSend.interceptOutcome(OUTGOING as never)).toBe('vetoed');
  });
});
