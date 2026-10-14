import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstalledPlugin } from '@/lib/plugin-types';

// We test the raw store by directly invoking Zustand
// Mock the external dependencies the store imports
vi.mock('@/lib/plugin-storage', () => ({
  pluginStorage: {
    saveCode: vi.fn().mockResolvedValue(undefined),
    getCode: vi.fn().mockResolvedValue(null),
    deleteCode: vi.fn().mockResolvedValue(undefined),
    saveThemeCSS: vi.fn().mockResolvedValue(undefined),
    getThemeCSS: vi.fn().mockResolvedValue(null),
    deleteThemeCSS: vi.fn().mockResolvedValue(undefined),
    savePreview: vi.fn().mockResolvedValue(undefined),
    getPreview: vi.fn().mockResolvedValue(null),
    deletePreview: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/plugin-validator', () => ({
  extractPlugin: vi.fn(),
}));

vi.mock('@/lib/plugin-loader', () => ({
  loadPlugin: vi.fn().mockResolvedValue(undefined),
  deactivatePlugin: vi.fn(),
  setPluginStoreAccessor: vi.fn(),
  setupAutoDisable: vi.fn(),
  setSandboxLocale: vi.fn(),
}));

vi.mock('@/lib/plugin-hooks', () => ({
  removeAllPluginHooks: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  downloadManagedBundle: vi.fn(),
}));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
const bridge = vi.hoisted(() => ({ setSettings: vi.fn() }));
vi.mock('@/lib/plugin-sandbox/host-bridge', () => ({
  forEachInstance: (_id: string, fn: (i: { setSettings: typeof bridge.setSettings }) => void) => fn({ setSettings: bridge.setSettings }),
}));
vi.mock('@/lib/plugin-sandbox/bundle-fetch', () => ({
  downloadManagedBundle: (...args: unknown[]) => mocks.downloadManagedBundle(...args),
}));

import { register as registerActive, deregister as deregisterActive, get as getActive } from '@/lib/plugin-sandbox/registry';
// Import after mocks
import { usePluginStore } from '@/stores/plugin-store';
import { pluginStorage } from '@/lib/plugin-storage';

function resetStore() {
  usePluginStore.setState({
    plugins: [],
    initialized: false,
  });
}

function mockPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'test-plugin',
    name: 'Test',
    version: '1.0.0',
    author: 'Test',
    description: '',
    type: 'hook',
    entrypoint: 'index.js',
    permissions: [],
    enabled: false,
    status: 'installed',
    settings: {},
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('usePluginStore', () => {
  describe('setPluginStatus', () => {
    it('updates status for existing plugin', () => {
      usePluginStore.setState({ plugins: [mockPlugin()] });
      usePluginStore.getState().setPluginStatus('test-plugin', 'running');
      expect(usePluginStore.getState().plugins[0].status).toBe('running');
    });

    it('sets error message', () => {
      usePluginStore.setState({ plugins: [mockPlugin()] });
      usePluginStore.getState().setPluginStatus('test-plugin', 'error', 'something broke');
      const p = usePluginStore.getState().plugins[0];
      expect(p.status).toBe('error');
      expect(p.error).toBe('something broke');
    });
  });

  describe('updatePluginSettings', () => {
    it('merges settings', () => {
      usePluginStore.setState({ plugins: [mockPlugin({ settings: { a: 1 } })] });
      usePluginStore.getState().updatePluginSettings('test-plugin', { b: 2 });
      expect(usePluginStore.getState().plugins[0].settings).toEqual({ a: 1, b: 2 });
    });
  });

  describe('disablePlugin', () => {
    it('sets enabled false and status disabled', () => {
      usePluginStore.setState({
        plugins: [mockPlugin({ enabled: true, status: 'running' })],
      });
      usePluginStore.getState().disablePlugin('test-plugin');
      const p = usePluginStore.getState().plugins[0];
      expect(p.enabled).toBe(false);
      expect(p.status).toBe('disabled');
    });
  });

  describe('uninstallPlugin', () => {
    it('removes plugin from list', () => {
      usePluginStore.setState({ plugins: [mockPlugin()] });
      usePluginStore.getState().uninstallPlugin('test-plugin');
      expect(usePluginStore.getState().plugins).toHaveLength(0);
    });

    it('no-op for unknown plugin', () => {
      usePluginStore.setState({ plugins: [mockPlugin()] });
      usePluginStore.getState().uninstallPlugin('unknown');
      expect(usePluginStore.getState().plugins).toHaveLength(1);
    });
  });

  describe('initializePlugins server sync', () => {
    const serverPlugin = {
      id: 'managed-plugin',
      name: 'Managed',
      version: '1.0.0',
      author: 'admin',
      description: '',
      type: 'hook',
      permissions: [],
      entrypoint: 'index.js',
      forceEnabled: true,
      bundleHash: 'hash-v1',
    };

    // The record the sync creates for serverPlugin once it has run before.
    function syncedRecord(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
      return mockPlugin({
        id: 'managed-plugin',
        name: 'Managed',
        author: 'admin',
        enabled: true,
        status: 'enabled',
        managed: true,
        forceEnabled: true,
        adminApproved: true,
        bundleHash: 'hash-v1',
        ...overrides,
      });
    }

    beforeEach(() => {
      localStorage.clear();
      mocks.apiFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ plugins: [serverPlugin], themes: [] }),
      });
      mocks.downloadManagedBundle.mockResolvedValue('bundle-code');
      vi.mocked(pluginStorage.getCode).mockResolvedValue(null);
    });

    it('installs a new server plugin and caches its bundle', async () => {
      await usePluginStore.getState().initializePlugins();

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1', { requireSignature: false });
      expect(pluginStorage.saveCode).toHaveBeenCalledWith('managed-plugin', 'bundle-code');
      const p = usePluginStore.getState().plugins.find(x => x.id === 'managed-plugin');
      expect(p).toMatchObject({ managed: true, enabled: true, bundleHash: 'hash-v1' });
    });

    it('re-downloads the bundle when the record is current but IndexedDB has no copy (#636)', async () => {
      usePluginStore.setState({ plugins: [syncedRecord()] });
      vi.mocked(pluginStorage.getCode).mockResolvedValue(null);

      await usePluginStore.getState().initializePlugins();

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1', { requireSignature: false });
      expect(pluginStorage.saveCode).toHaveBeenCalledWith('managed-plugin', 'bundle-code');
      expect(usePluginStore.getState().plugins).toHaveLength(1);
    });

    it('leaves a current plugin alone when its bundle is cached', async () => {
      usePluginStore.setState({ plugins: [syncedRecord()] });
      vi.mocked(pluginStorage.getCode).mockResolvedValue('cached-code');

      await usePluginStore.getState().initializePlugins();

      expect(mocks.downloadManagedBundle).not.toHaveBeenCalled();
      expect(pluginStorage.saveCode).not.toHaveBeenCalled();
    });

    it('re-downloads when the server hash changed even though a bundle is cached', async () => {
      usePluginStore.setState({ plugins: [syncedRecord({ bundleHash: 'hash-v0' })] });
      vi.mocked(pluginStorage.getCode).mockResolvedValue('cached-code');

      await usePluginStore.getState().initializePlugins();

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1', { requireSignature: false });
      expect(usePluginStore.getState().plugins[0].bundleHash).toBe('hash-v1');
    });

    it('keeps the record when the download fails so the error can surface at load time', async () => {
      usePluginStore.setState({ plugins: [syncedRecord()] });
      mocks.downloadManagedBundle.mockRejectedValue(new Error('Could not download the bundle (HTTP 503)'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await usePluginStore.getState().initializePlugins();

      expect(pluginStorage.saveCode).not.toHaveBeenCalled();
      expect(usePluginStore.getState().plugins).toHaveLength(1);
      expect(usePluginStore.getState().initialized).toBe(true);
    });
  });
});

describe('installPlugin', () => {
  beforeEach(() => {
    resetStore();
  });

  it('keeps the translations a plugin ships', async () => {
    const { extractPlugin } = await import('@/lib/plugin-validator');
    vi.mocked(extractPlugin).mockResolvedValueOnce({
      valid: true, errors: [], warnings: [], preview: null, code: 'module.exports = {}',
      manifest: {
        id: 'translated', name: 'T', version: '1.0.0', author: 'a', description: '', type: 'hook',
        permissions: [], entrypoint: 'index.js', locales: { de: { hello: 'Hallo' } },
      },
    });

    const result = await usePluginStore.getState().installPlugin(new File(['x'], 'p.zip'));

    expect(result.success).toBe(true);
    expect(usePluginStore.getState().plugins[0].locales).toEqual({ de: { hello: 'Hallo' } });
  });
});

describe('plugins the user installs', () => {
  const MANIFEST = {
    id: 'mine', name: 'Mine', version: '1.0.0', author: 'a', description: '', type: 'hook' as const,
    permissions: [], entrypoint: 'index.js',
  };

  async function setFeatures(features: Record<string, boolean>) {
    const { usePolicyStore } = await import('@/stores/policy-store');
    const { DEFAULT_POLICY } = await import('@/lib/admin/types');
    usePolicyStore.setState({ policy: { ...DEFAULT_POLICY, features: { ...DEFAULT_POLICY.features, ...features } } });
  }

  async function mockExtract() {
    const { extractPlugin } = await import('@/lib/plugin-validator');
    vi.mocked(extractPlugin).mockResolvedValue({
      valid: true, errors: [], warnings: [], preview: null, code: 'module.exports = {}', manifest: MANIFEST,
    });
  }

  beforeEach(() => {
    resetStore();
    localStorage.removeItem('server-managed-plugin-ids');
    mocks.apiFetch.mockReset();
  });

  it('refuses an install when the admin turned uploads off', async () => {
    await setFeatures({ pluginsUploadEnabled: false });
    await mockExtract();

    const result = await usePluginStore.getState().installPlugin(new File(['x'], 'p.zip'));

    expect(result).toMatchObject({ success: false, reason: 'uploads-disabled' });
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });

  it('refuses a package that reuses the id of an admin plugin', async () => {
    await setFeatures({ pluginsUploadEnabled: true, requirePluginApproval: false });
    await mockExtract();
    usePluginStore.setState({ plugins: [mockPlugin({ id: 'mine', managed: true })] });

    const result = await usePluginStore.getState().installPlugin(new File(['x'], 'p.zip'));

    expect(result).toMatchObject({ success: false, reason: 'managed-id' });
    expect(usePluginStore.getState().plugins[0].managed).toBe(true);
  });

  it('sends the package for approval and keeps it off until approved', async () => {
    await setFeatures({ pluginsUploadEnabled: true, requirePluginApproval: true });
    await mockExtract();
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ status: 'pending' }));
      return new Response(JSON.stringify({ status: 'pending' }));
    });

    const result = await usePluginStore.getState().installPlugin(new File(['x'], 'p.zip'));
    await usePluginStore.getState().enablePlugin('mine');

    expect(result.approvalStatus).toBe('pending');
    const posted = mocks.apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect((posted?.[1] as RequestInit).body).toBeInstanceOf(FormData);
    const plugin = usePluginStore.getState().plugins[0];
    expect(plugin.enabled).toBe(false);
    expect(plugin.error).toBe('approval-pending');
  });

  it('turns an approved package on', async () => {
    await setFeatures({ pluginsUploadEnabled: true, requirePluginApproval: true });
    await mockExtract();
    mocks.apiFetch.mockImplementation(async () => new Response(JSON.stringify({ status: 'approved' })));

    await usePluginStore.getState().installPlugin(new File(['x'], 'p.zip'));
    await usePluginStore.getState().enablePlugin('mine');

    expect(usePluginStore.getState().plugins[0].enabled).toBe(true);
  });

  it('does not load a user plugin whose approval was revoked', async () => {
    await setFeatures({ pluginsUploadEnabled: true, requirePluginApproval: true });
    const { loadPlugin } = await import('@/lib/plugin-loader');
    vi.mocked(loadPlugin).mockClear();
    usePluginStore.setState({ plugins: [mockPlugin({ id: 'mine', enabled: true, status: 'enabled', managed: false, approvalHash: 'a'.repeat(64) })] });
    mocks.apiFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/plugins') ? new Response(JSON.stringify({ plugins: [], themes: [] })) : new Response(JSON.stringify({ status: 'denied' })));

    await usePluginStore.getState().initializePlugins();

    expect(loadPlugin).not.toHaveBeenCalled();
    expect(usePluginStore.getState().plugins[0].error).toBe('approval-denied');
  });
});

describe('updatePluginSettings', () => {
  it('sends the new settings to the running plugin right away', () => {
    // Settings used to reach a plugin only after a reload.
    resetStore();
    bridge.setSettings.mockClear();
    usePluginStore.setState({ plugins: [mockPlugin({
      id: 'p', settings: {},
      settingsSchema: { size: { type: 'number', label: 'Size', default: 160, min: 16, max: 512 } },
    })] });

    usePluginStore.getState().updatePluginSettings('p', { size: 9000 });

    expect(usePluginStore.getState().plugins[0].settings.size).toBe(512);
    expect(bridge.setSettings).toHaveBeenCalledWith({ size: 512 });
  });

  it('passes on settings that arrive another way, and new slots start with them', () => {
    resetStore();
    bridge.setSettings.mockClear();
    const plugin = mockPlugin({ id: 'synced', settings: { zone: 'Europe/Berlin' } });
    usePluginStore.setState({ plugins: [plugin] });
    registerActive({ plugin, code: '', tier: 'untrusted', background: {}, slotOffers: [], hookDisposables: [] } as never);
    try {
      // A server sync replaces the plugin list without updatePluginSettings.
      usePluginStore.setState({ plugins: [{ ...plugin, settings: { zone: 'Asia/Tokyo' } }] });

      expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ zone: 'Asia/Tokyo' }));
      expect(getActive('synced')?.plugin.settings).toEqual({ zone: 'Asia/Tokyo' });
    } finally {
      deregisterActive('synced');
    }
  });
});

describe('plugins the admin removed', () => {
  it('lose what they stored, like an uninstalled plugin', async () => {
    // Their data used to survive and come back when the admin re-added them.
    resetStore();
    localStorage.setItem('server-managed-plugin-ids', JSON.stringify(['gone']));
    localStorage.setItem('plugin:gone:@acct:notes', '"secret"');
    usePluginStore.setState({ plugins: [mockPlugin({ id: 'gone', managed: true })] });
    mocks.apiFetch.mockImplementation(async () => new Response(JSON.stringify({ plugins: [], themes: [] })));

    await usePluginStore.getState().initializePlugins();

    expect(usePluginStore.getState().plugins.some((p) => p.id === 'gone')).toBe(false);
    expect(localStorage.getItem('plugin:gone:@acct:notes')).toBeNull();
    expect(pluginStorage.deletePreview).toHaveBeenCalledWith('gone');
  });
});
