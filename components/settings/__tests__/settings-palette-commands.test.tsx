import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/locales/en/common.json';

// #40 / SET-27: in Settings the palette offered only "Go to Settings", and
// "out of office" found nothing. Each page the list shows is a command now,
// found by the words the settings search knows.

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string, values?: Record<string, string>) =>
    `${ns ? `${ns}.` : ''}${key}${values?.name ? `(${values.name})` : ''}`,
  useMessages: () => en,
  useLocale: () => 'en',
  useFormatter: () => ({ dateTime: String, relativeTime: String, number: String }),
}));
vi.mock('@/hooks/use-media-query', () => ({
  useIsDesktop: () => true,
  useIsMobile: () => false,
  useMediaQuery: () => false,
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail', stalwartFeaturesEnabled: true }) }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/sidebar-apps-modal', () => ({ SidebarAppsModal: () => null }));
vi.mock('@/components/plugins/app-top-banner-slot', () => ({ AppTopBannerSlot: () => null }));
vi.mock('@/components/settings/appearance-settings', () => ({ AppearanceSettings: () => null }));

const { SettingsApp } = await import('../settings-app');
const { useAuthStore } = await import('@/stores/auth-store');
const { usePluginStore } = await import('@/stores/plugin-store');
const { useThemeStore } = await import('@/stores/theme-store');
const { useRegisteredCommandGroups, commandMatches } = await import('@/lib/command-registry');

type Groups = ReturnType<typeof useRegisteredCommandGroups>;
let groups: Groups = [];
function Probe() {
  groups = useRegisteredCommandGroups();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  // A server with Sieve and vacation, so Filters and Out of office are pages.
  const client = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'getAccountId') return () => 'acc';
      if (typeof prop === 'string' && prop.startsWith('supports')) return () => true;
      return () => null;
    },
  });
  useAuthStore.setState({ isAuthenticated: true, isLoading: false, client: client as never });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) } as never);
  try { localStorage.setItem('settings-active-tab', 'appearance'); } catch { /* ignore */ }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function settingsCommands() {
  const group = groups.find((g) => g.label === 'sidebar.settings');
  return group?.commands ?? [];
}

function find(query: string) {
  return settingsCommands().filter((c) => commandMatches(query, c.label, c.keywords));
}

describe('Settings commands in the palette', () => {
  it('offers "Go to <page>" for the settings pages', async () => {
    render(<><SettingsApp linkSegments={[]} /><Probe /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const ids = settingsCommands().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['go-vacation', 'go-filters', 'go-security', 'go-account']));
    expect(settingsCommands().find((c) => c.id === 'go-vacation')?.label).toBe('command_palette.go_to(settings.tabs.vacation)');
  });

  it('names the pages called like an app as settings, apart from the app itself', async () => {
    render(<><SettingsApp linkSegments={[]} /><Probe /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const label = (id: string) => settingsCommands().find((c) => c.id === id)?.label;
    expect(label('go-calendar')).toBe('command_palette.go_to_settings_page(settings.tabs.calendar)');
    expect(label('go-contacts')).toBe('command_palette.go_to_settings_page(settings.tabs.contacts)');
    expect(label('go-vacation')).toBe('command_palette.go_to(settings.tabs.vacation)');
  });

  it('finds pages by the words the settings search knows', async () => {
    render(<><SettingsApp linkSegments={[]} /><Probe /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(find('out of office').map((c) => c.id)).toContain('go-vacation');
    expect(find('app password').map((c) => c.id)).toContain('go-security');
    expect(find('add rule').map((c) => c.id)).toContain('go-filters');
  });

  it('opens the page it names', async () => {
    const tree = () => <><SettingsApp linkSegments={[]} /><Probe /></>;
    const { rerender } = render(tree());
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    act(() => settingsCommands().find((c) => c.id === 'go-filters')!.run());
    expect(localStorage.getItem('settings-active-tab')).toBe('filters');
    // The palette reads the commands when it opens, after Settings drew
    // the new page; a second render stands in for that here.
    rerender(tree());
    rerender(tree());
    // The page that is open is not offered.
    expect(settingsCommands().map((c) => c.id)).not.toContain('go-filters');
  });
});
