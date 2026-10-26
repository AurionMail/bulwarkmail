import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/browser-navigation', async (orig) => ({
  ...(await orig<typeof import('@/lib/browser-navigation')>()),
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock('@/lib/plugin-loader', () => ({
  loadPlugin: vi.fn().mockResolvedValue(undefined),
  deactivatePlugin: vi.fn(),
  setPluginStoreAccessor: vi.fn(),
  setupAutoDisable: vi.fn(),
  setSandboxLocale: vi.fn(),
  forgetSlotOffers: vi.fn(),
}));

import { fetchServerPluginList } from '@/lib/server-plugin-list';
import { usePluginStore } from '@/stores/plugin-store';
import { useThemeStore } from '@/stores/theme-store';

const pluginListCalls = () => mocks.apiFetch.mock.calls.filter(([url]) => url === '/api/plugins');

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async () => new Response(JSON.stringify({ plugins: [], themes: [] })));
});

describe('the server plugin list', () => {
  it('is fetched once when the plugin and theme stores sync at the same time', async () => {
    usePluginStore.setState({ plugins: [], initialized: false });

    // What the mail view does on mount.
    await Promise.all([
      usePluginStore.getState().initializePlugins(),
      useThemeStore.getState().syncServerThemes(),
    ]);

    expect(pluginListCalls()).toHaveLength(1);
    expect(usePluginStore.getState().initialized).toBe(true);
  });

  it('is fetched again by a later call', async () => {
    const first = await fetchServerPluginList();
    const second = await fetchServerPluginList();

    expect(pluginListCalls()).toHaveLength(2);
    expect(first.data).toEqual({ plugins: [], themes: [] });
    expect(second.ok).toBe(true);
  });

  it('passes a refused request on without a body', async () => {
    mocks.apiFetch.mockImplementation(async () => new Response('{"error":"Not authenticated"}', { status: 401 }));

    await expect(fetchServerPluginList()).resolves.toEqual({ ok: false, status: 401, data: null });
  });
});
