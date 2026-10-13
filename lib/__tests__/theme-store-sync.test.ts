import { describe, it, expect, vi, beforeEach } from 'vitest';

const serverThemes: { themes: unknown[] } = { themes: [] };
vi.mock('@/lib/browser-navigation', async (orig) => ({
  ...(await orig<typeof import('@/lib/browser-navigation')>()),
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ plugins: [], ...serverThemes }))),
}));
vi.mock('@/lib/plugin-storage', () => ({
  pluginStorage: {
    saveThemeCSS: vi.fn(async () => {}),
    getThemeCSS: vi.fn(async () => null),
    deleteThemeCSS: vi.fn(async () => {}),
    deleteThemeSkin: vi.fn(async () => {}),
    deletePreview: vi.fn(async () => {}),
    getThemeSkin: vi.fn(async () => null),
  },
}));

import { useThemeStore } from '@/stores/theme-store';
import { pluginStorage } from '@/lib/plugin-storage';
import type { InstalledTheme } from '@/lib/plugin-types';

const CORP: InstalledTheme = {
  id: 'corp', name: 'Corp', version: '1.0.0', author: 'IT', description: '',
  css: ':root{--color-primary:red}', variants: ['light', 'dark'],
  enabled: true, builtIn: false, managed: true, forceEnabled: true,
};

beforeEach(() => {
  serverThemes.themes = [];
  const builtIns = useThemeStore.getState().installedThemes.filter((t) => t.builtIn);
  useThemeStore.setState({ installedThemes: [...builtIns, CORP], activeThemeId: 'corp' });
});

describe('server theme sync', () => {
  it('drops a managed theme the admin deleted, and stops forcing it', async () => {
    await useThemeStore.getState().syncServerThemes();

    const state = useThemeStore.getState();
    expect(state.installedThemes.some((t) => t.id === 'corp')).toBe(false);
    expect(state.activeThemeId).toBeNull();
    expect(pluginStorage.deleteThemeCSS).toHaveBeenCalledWith('corp');
  });

  it('keeps a theme the user installed themselves', async () => {
    const mine: InstalledTheme = { ...CORP, id: 'mine', managed: false, forceEnabled: false };
    useThemeStore.setState((s) => ({ installedThemes: [...s.installedThemes, mine] }));

    await useThemeStore.getState().syncServerThemes();

    expect(useThemeStore.getState().installedThemes.some((t) => t.id === 'mine')).toBe(true);
  });

  it('leaves everything alone when the server list could not be read', async () => {
    const { apiFetch } = await import('@/lib/browser-navigation');
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('nope', { status: 500 }));

    await useThemeStore.getState().syncServerThemes();

    expect(useThemeStore.getState().installedThemes.some((t) => t.id === 'corp')).toBe(true);
  });
});
