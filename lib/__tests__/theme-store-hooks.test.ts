import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllHooks, themeHooks } from '@/lib/plugin-hooks';
import { useThemeStore } from '@/stores/theme-store';

beforeEach(() => {
  clearAllHooks();
  useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', activeThemeId: null });
});

describe('theme hooks', () => {
  it('tells plugins when the colour scheme changes', () => {
    const fn = vi.fn();
    themeHooks.onThemeChange.register('t', fn);

    useThemeStore.getState().setTheme('dark');

    expect(fn).toHaveBeenCalledWith({ theme: 'dark', resolved: 'dark' });
  });

  it('tells plugins when another theme is activated, and not when nothing changed', () => {
    const fn = vi.fn();
    themeHooks.onCustomThemeChange.register('t', fn);

    useThemeStore.setState({ activeThemeId: 'ocean' });
    useThemeStore.setState({ activeThemeId: 'ocean' });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ themeId: 'ocean' });
  });
});
