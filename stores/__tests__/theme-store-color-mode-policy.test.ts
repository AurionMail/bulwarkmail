import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browser-navigation', () => ({ apiFetch }));

import { useThemeStore } from '../theme-store';
import { useSettingsStore } from '../settings-store';
import { usePolicyStore } from '../policy-store';
import { DEFAULT_POLICY, DEFAULT_THEME_POLICY, type ThemePolicy } from '@/lib/admin/types';

// #1280: themePolicy could enforce a theme, but not light, dark or system.

function loadThemePolicy(patch: Partial<ThemePolicy>) {
  usePolicyStore.setState({
    policy: { ...DEFAULT_POLICY, themePolicy: { ...DEFAULT_THEME_POLICY, ...patch } },
    loaded: true,
  });
}

const importBlob = (blob: Record<string, unknown>) =>
  useSettingsStore.getState().importSettings(JSON.stringify(blob));

const theme = () => useThemeStore.getState();

beforeEach(() => {
  localStorage.clear();
  usePolicyStore.setState({ policy: { ...DEFAULT_POLICY }, loaded: false });
  useThemeStore.setState({ theme: 'system', themeChosen: false });
});

describe('color mode policy (#1280)', () => {
  it('applies the default to a user who never picked a mode', () => {
    loadThemePolicy({ defaultColorMode: 'light' });
    expect(theme().theme).toBe('light');
    expect(theme().themeChosen).toBe(false);
  });

  it('keeps a mode the user picked, even system', () => {
    theme().setTheme('system');
    loadThemePolicy({ defaultColorMode: 'light' });
    expect(theme().theme).toBe('system');
  });

  it('follows the operator changing a default the user never touched', () => {
    loadThemePolicy({ defaultColorMode: 'light' });
    loadThemePolicy({ defaultColorMode: 'dark' });
    expect(theme().theme).toBe('dark');
  });

  it('enforces a locked mode over the user\'s pick and ignores picking another', () => {
    theme().setTheme('dark');
    loadThemePolicy({ defaultColorMode: 'light', lockColorMode: true });
    expect(theme().theme).toBe('light');

    theme().setTheme('dark');
    expect(theme().theme).toBe('light');
    expect(theme().resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('locks to system when no default mode is set', () => {
    theme().setTheme('dark');
    loadThemePolicy({ lockColorMode: true });
    expect(theme().theme).toBe('system');
  });

  it('ignores a default that is not a color mode', () => {
    loadThemePolicy({ defaultColorMode: 'Dark' as never });
    expect(theme().theme).toBe('system');
  });
});

describe('color mode policy and synced settings (#1280)', () => {
  it('applies the default over a synced mode the user never chose', () => {
    loadThemePolicy({ defaultColorMode: 'light' });
    importBlob({ theme: 'system', themeChosen: false });
    expect(theme().theme).toBe('light');
  });

  it('keeps a synced mode the user chose', () => {
    loadThemePolicy({ defaultColorMode: 'light' });
    importBlob({ theme: 'system', themeChosen: true });
    expect(theme().theme).toBe('system');
    expect(theme().themeChosen).toBe(true);
  });

  it('counts a mode other than system in an older blob as chosen', () => {
    loadThemePolicy({ defaultColorMode: 'light' });
    importBlob({ theme: 'dark' });
    expect(theme().theme).toBe('dark');
    importBlob({ theme: 'system' });
    expect(theme().theme).toBe('light');
  });

  it('syncs whether the user chose the mode', () => {
    expect(JSON.parse(useSettingsStore.getState().exportSettings()).themeChosen).toBe(false);
    theme().setTheme('dark');
    expect(JSON.parse(useSettingsStore.getState().exportSettings()).themeChosen).toBe(true);
  });
});

describe('theme settings stored before #1280', () => {
  it.each([
    ['dark', true],
    ['system', false],
  ])('takes a stored %s mode as chosen: %s', async (stored, chosen) => {
    localStorage.setItem('theme-storage', JSON.stringify({ state: { theme: stored, activeThemeId: null, installedThemes: [] }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(theme().theme).toBe(stored);
    expect(theme().themeChosen).toBe(chosen);
  });
});
