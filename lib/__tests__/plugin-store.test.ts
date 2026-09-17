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
vi.mock('@/lib/plugin-sandbox/bundle-fetch', () => ({
  downloadManagedBundle: (...args: unknown[]) => mocks.downloadManagedBundle(...args),
}));

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

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1');
      expect(pluginStorage.saveCode).toHaveBeenCalledWith('managed-plugin', 'bundle-code');
      const p = usePluginStore.getState().plugins.find(x => x.id === 'managed-plugin');
      expect(p).toMatchObject({ managed: true, enabled: true, bundleHash: 'hash-v1' });
    });

    it('re-downloads the bundle when the record is current but IndexedDB has no copy (#636)', async () => {
      usePluginStore.setState({ plugins: [syncedRecord()] });
      vi.mocked(pluginStorage.getCode).mockResolvedValue(null);

      await usePluginStore.getState().initializePlugins();

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1');
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

      expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', 'hash-v1');
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
