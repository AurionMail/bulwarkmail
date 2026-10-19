import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '@/lib/plugin-types';

// settings-page: a page of its own in Settings for each plugin that offers
// one, nested under Add-ons with the plugin's name.

const createSlotInstance = vi.fn((..._args: unknown[]) => ({ destroy: vi.fn(), updateProps: vi.fn(), setTheme: vi.fn() }));
vi.mock('@/lib/plugin-sandbox/host-bridge', () => ({
  createSlotInstance: (...args: unknown[]) => createSlotInstance(...args),
}));
vi.mock('@/lib/plugin-sandbox/host-theme', () => ({ snapshotHostTheme: () => ({}) }));
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
  useMessages: () => ({}),
  useLocale: () => 'en',
  useFormatter: () => ({ dateTime: String, relativeTime: String, number: String }),
}));
vi.mock('@/hooks/use-media-query', () => ({
  useIsDesktop: () => true,
  useIsMobile: () => false,
  useMediaQuery: () => false,
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail', stalwartFeaturesEnabled: false }) }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/sidebar-apps-modal', () => ({ SidebarAppsModal: () => null }));
vi.mock('@/components/plugins/app-top-banner-slot', () => ({ AppTopBannerSlot: () => null }));
vi.mock('@/components/settings/appearance-settings', () => ({ AppearanceSettings: () => <div>appearance pane</div> }));

const { SettingsApp } = await import('../settings-app');
const registry = await import('@/lib/plugin-sandbox/registry');
const { useAuthStore } = await import('@/stores/auth-store');
const { usePluginStore } = await import('@/stores/plugin-store');
const { useThemeStore } = await import('@/stores/theme-store');

function activate(id: string, name: string, slots: string[]) {
  const plugin: InstalledPlugin = {
    id, name, version: '1.0.0', author: '', description: '', type: 'ui-extension',
    permissions: ['ui:settings-section'], grantedPermissions: ['ui:settings-section'], entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
  registry.register({
    plugin, code: '', tier: 'untrusted',
    background: { evaluateShouldShow: vi.fn(async () => true) } as never,
    slotOffers: slots.map((slot) => ({ name: slot as never, order: 100, hasShouldShow: false })),
    hookDisposables: [],
  });
}

beforeEach(() => {
  createSlotInstance.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  try { localStorage.setItem('settings-active-tab', 'appearance'); } catch { /* ignore */ }
  // Every capability check answers "no"; ids are plain strings.
  const client = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : (prop === 'getAccountId' ? () => 'acc' : () => null)),
  });
  useAuthStore.setState({ isAuthenticated: true, isLoading: false, client: client as never });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) } as never);
});
afterEach(() => {
  for (const p of registry.all()) registry.deregister(p.plugin.id);
  vi.unstubAllGlobals();
});

describe('Settings plugin pages', () => {
  it('nests a plugin with only a section under Add-ons', () => {
    activate('smime', 'S/MIME', ['settings-section']);
    render(<SettingsApp linkSegments={[]} />);

    const addons = screen.getByTestId('settings-tab-addons');
    const entry = screen.getByTestId('settings-tab-plugin:smime');
    expect(addons.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.className).toContain('ps-9');
  });

  it('lists the plugin by name under Add-ons and opens its page full width', async () => {
    activate('kanban', 'Kanban', ['settings-page']);
    const { container } = render(<SettingsApp linkSegments={[]} />);

    const addons = screen.getByTestId('settings-tab-addons');
    const entry = screen.getByRole('button', { name: /Kanban/ });
    expect(addons.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.className).toContain('ps-9');
    expect(createSlotInstance).not.toHaveBeenCalled();

    act(() => { fireEvent.click(entry); });

    const pane = container.querySelector('[data-plugin-slot="settings-page"]')!;
    expect(pane).not.toBeNull();
    expect(pane.parentElement?.className).not.toContain('max-w-3xl');
    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    const opts = createSlotInstance.mock.calls[0][0] as { slot: string; plugin: { id: string } };
    expect(opts.slot).toBe('settings-page');
    expect(opts.plugin.id).toBe('kanban');
  });

  it('gives a plugin with both a page and a section one entry, with the section on its page', async () => {
    activate('showcase', 'Showcase', ['settings-section', 'settings-page']);
    const { container } = render(<SettingsApp linkSegments={[]} />);

    const entries = screen.getAllByRole('button', { name: /Showcase/ });
    expect(entries).toHaveLength(1);

    act(() => { fireEvent.click(entries[0]); });
    await waitFor(() => expect(createSlotInstance).toHaveBeenCalledTimes(2));
    const slots = createSlotInstance.mock.calls.map((call) => (call[0] as { slot: string }).slot);
    expect(slots.sort()).toEqual(['settings-page', 'settings-section']);
    const section = container.querySelector('[data-plugin-slot="settings-section"]')!;
    const page = container.querySelector('[data-plugin-slot="settings-page"]')!;
    expect(section.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the page of such a plugin from an old link to its section', async () => {
    activate('showcase', 'Showcase', ['settings-section', 'settings-page']);
    const { container } = render(<SettingsApp linkSegments={['plugin:showcase']} />);

    await waitFor(() => expect(container.querySelector('[data-plugin-slot="settings-page"]')).not.toBeNull());
  });

  it('opens the page from a /settings/plugin-page:<id> link', async () => {
    activate('kanban', 'Kanban', ['settings-page']);
    render(<SettingsApp linkSegments={['plugin-page:kanban']} />);

    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    expect((createSlotInstance.mock.calls[0][0] as { slot: string }).slot).toBe('settings-page');
  });
});
