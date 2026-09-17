import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { InstalledPlugin } from '../plugin-types';

const mocks = vi.hoisted(() => ({
  getCode: vi.fn(),
  saveCode: vi.fn(),
  downloadManagedBundle: vi.fn(),
  createBackgroundInstance: vi.fn(),
}));

vi.mock('../plugin-storage', () => ({
  pluginStorage: {
    getCode: (...args: unknown[]) => mocks.getCode(...args),
    saveCode: (...args: unknown[]) => mocks.saveCode(...args),
    deleteCode: vi.fn(),
  },
}));
vi.mock('../plugin-sandbox/bundle-fetch', () => ({
  downloadManagedBundle: (...args: unknown[]) => mocks.downloadManagedBundle(...args),
}));
vi.mock('../plugin-sandbox/host-bridge', () => ({
  createBackgroundInstance: (...args: unknown[]) => mocks.createBackgroundInstance(...args),
  SandboxInstance: class {},
}));
vi.mock('../plugin-sandbox/host-api', () => ({
  cancelPluginDialogs: vi.fn(),
}));
vi.mock('../plugin-sandbox/shortcuts', () => ({
  registerShortcuts: () => () => {},
}));

import { loadSandboxedPlugin, unloadSandboxedPlugin, setSandboxStoreAccessor } from '../plugin-sandbox/loader';
import { get as getActive } from '../plugin-sandbox/registry';

const CODE = 'export default { activate() {} }';
const HASH = createHash('sha256').update(CODE, 'utf-8').digest('hex');

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'managed-plugin',
    name: 'Managed plugin',
    version: '1.0.0',
    author: 'admin',
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

function fakeBackground() {
  return {
    initPromise: Promise.resolve({ hooks: [], slots: [], shortcuts: [] }),
    invokeHook: vi.fn(),
    destroy: vi.fn(),
  };
}

let statuses: Array<{ id: string; status: string; error?: string }>;

beforeEach(() => {
  statuses = [];
  setSandboxStoreAccessor({
    setPluginStatus: (id, status, error) => { statuses.push({ id, status, error }); },
  });
  mocks.getCode.mockReset().mockResolvedValue(null);
  mocks.saveCode.mockReset().mockResolvedValue(undefined);
  mocks.downloadManagedBundle.mockReset();
  mocks.createBackgroundInstance.mockReset().mockImplementation(() => fakeBackground());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  unloadSandboxedPlugin('managed-plugin');
  unloadSandboxedPlugin('user-plugin');
  vi.restoreAllMocks();
});

function lastStatus() {
  return statuses[statuses.length - 1];
}

describe('loadSandboxedPlugin bundle sourcing', () => {
  it('runs a managed plugin from IndexedDB when the cached copy verifies', async () => {
    mocks.getCode.mockResolvedValue(CODE);
    await loadSandboxedPlugin(plugin());
    expect(lastStatus()).toMatchObject({ id: 'managed-plugin', status: 'running' });
    expect(mocks.downloadManagedBundle).not.toHaveBeenCalled();
    expect(mocks.createBackgroundInstance).toHaveBeenCalledWith(expect.objectContaining({ code: CODE }));
    expect(getActive('managed-plugin')).toBeDefined();
  });

  it('refills a missing managed bundle from the server (#636)', async () => {
    mocks.getCode.mockResolvedValue(null);
    mocks.downloadManagedBundle.mockResolvedValue(CODE);
    await loadSandboxedPlugin(plugin());
    expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', HASH);
    expect(mocks.saveCode).toHaveBeenCalledWith('managed-plugin', CODE);
    expect(lastStatus()).toMatchObject({ status: 'running' });
    expect(getActive('managed-plugin')?.code).toBe(CODE);
  });

  it('replaces a cached managed bundle that fails the hash check', async () => {
    mocks.getCode.mockResolvedValue('stale or tampered copy');
    mocks.downloadManagedBundle.mockResolvedValue(CODE);
    await loadSandboxedPlugin(plugin());
    expect(mocks.downloadManagedBundle).toHaveBeenCalledTimes(1);
    expect(mocks.saveCode).toHaveBeenCalledWith('managed-plugin', CODE);
    expect(lastStatus()).toMatchObject({ status: 'running' });
  });

  it('fails when the server copy does not match the record hash either', async () => {
    mocks.getCode.mockResolvedValue(null);
    mocks.downloadManagedBundle.mockResolvedValue('something else entirely');
    await loadSandboxedPlugin(plugin());
    expect(lastStatus()).toMatchObject({ status: 'error', error: expect.stringMatching(/integrity mismatch/) });
    expect(mocks.saveCode).not.toHaveBeenCalled();
    expect(mocks.createBackgroundInstance).not.toHaveBeenCalled();
    expect(getActive('managed-plugin')).toBeUndefined();
  });

  it('surfaces the download failure on the plugin', async () => {
    mocks.downloadManagedBundle.mockRejectedValue(
      new Error('Could not download the bundle for plugin "managed-plugin" (HTTP 404)'),
    );
    await loadSandboxedPlugin(plugin());
    expect(lastStatus()).toMatchObject({ status: 'error', error: expect.stringMatching(/HTTP 404/) });
    expect(mocks.createBackgroundInstance).not.toHaveBeenCalled();
  });

  it('accepts a managed bundle without a recorded hash (older records)', async () => {
    mocks.downloadManagedBundle.mockResolvedValue(CODE);
    await loadSandboxedPlugin(plugin({ bundleHash: undefined }));
    expect(mocks.downloadManagedBundle).toHaveBeenCalledWith('managed-plugin', undefined);
    expect(lastStatus()).toMatchObject({ status: 'running' });
  });

  it('still runs a managed plugin when the cache cannot be written', async () => {
    mocks.downloadManagedBundle.mockResolvedValue(CODE);
    mocks.saveCode.mockRejectedValue(new Error('QuotaExceededError'));
    await loadSandboxedPlugin(plugin());
    expect(lastStatus()).toMatchObject({ status: 'running' });
  });

  it('still runs a managed plugin when IndexedDB cannot be read', async () => {
    mocks.getCode.mockRejectedValue(new Error('InvalidStateError'));
    mocks.downloadManagedBundle.mockResolvedValue(CODE);
    await loadSandboxedPlugin(plugin());
    expect(lastStatus()).toMatchObject({ status: 'running' });
  });

  it('does not consult the server for a user-uploaded plugin', async () => {
    mocks.getCode.mockResolvedValue(null);
    await loadSandboxedPlugin(plugin({ id: 'user-plugin', managed: false }));
    expect(mocks.downloadManagedBundle).not.toHaveBeenCalled();
    expect(lastStatus()).toMatchObject({
      id: 'user-plugin',
      status: 'error',
      error: expect.stringMatching(/No bundle in storage.*Reinstall/),
    });
  });

  it('fails a user-uploaded plugin whose cached copy does not verify', async () => {
    mocks.getCode.mockResolvedValue('tampered');
    await loadSandboxedPlugin(plugin({ id: 'user-plugin', managed: false }));
    expect(mocks.downloadManagedBundle).not.toHaveBeenCalled();
    expect(lastStatus()).toMatchObject({ status: 'error', error: expect.stringMatching(/integrity mismatch/) });
  });
});
