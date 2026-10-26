import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Section deep links: `/settings/<tab>/<section>` and the ids of retired tabs
// land on the page and section that hold the setting now. The jump row at the
// top of a page lists its sections.

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
vi.mock('@/components/settings/organize-settings', () => ({
  OrganizeSettings: () => (
    <div>
      <div data-settings-section="folders"><h3>Folders</h3></div>
      <div data-settings-section="tags"><h3>Tags</h3></div>
    </div>
  ),
}));
vi.mock('@/components/settings/account-settings', () => ({
  AccountSettings: () => (
    <div>
      <div data-settings-section="profile"><h3>Profile</h3></div>
      <div data-settings-section="addresses"><h3>Email addresses</h3></div>
    </div>
  ),
}));

const { SettingsApp } = await import('../settings-app');
const { useAuthStore } = await import('@/stores/auth-store');
const { usePluginStore } = await import('@/stores/plugin-store');
const { useThemeStore } = await import('@/stores/theme-store');
const { useSettingsStore } = await import('@/stores/settings-store');
const { SettingsSection } = await import('../settings-section');

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push((this as HTMLElement).dataset.settingsSection ?? this.tagName);
  };
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  try { localStorage.setItem('settings-active-tab', 'appearance'); } catch { /* ignore */ }
  const client = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : (prop === 'getAccountId' ? () => 'acc' : () => null)),
  });
  useAuthStore.setState({ isAuthenticated: true, isLoading: false, client: client as never });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) } as never);
  act(() => { useSettingsStore.setState({ showAdvancedSettings: false }); });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings section links', () => {
  it('lands an old /settings/keywords link on the tags section of Folders & tags', async () => {
    render(<SettingsApp linkSegments={['keywords']} />);
    expect(screen.getByTestId('settings-tab-organize')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(scrolled).toContain('tags'));
  });

  it('lands /settings/organize/folders on that section', async () => {
    render(<SettingsApp linkSegments={['organize', 'folders']} />);
    await waitFor(() => expect(scrolled).toContain('folders'));
    expect(scrolled).not.toContain('tags');
  });

  it('lists the sections of the open page in the jump row', async () => {
    render(<SettingsApp linkSegments={['organize']} />);
    const nav = screen.getByTestId('settings-section-nav');
    await waitFor(() => expect(nav).not.toHaveAttribute('hidden'));
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    expect(scrolled).toContain('tags');
  });

  it('follows a tab-change event that names a retired tab to its new section', async () => {
    render(<SettingsApp linkSegments={[]} />);
    act(() => { window.dispatchEvent(new CustomEvent('settings-tab-change', { detail: 'identities' })); });
    expect(screen.getByTestId('settings-tab-account')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(scrolled).toContain('addresses'));
  });

  it('turns the Advanced switch on when a link names a section it hides', async () => {
    function AdvancedPage() {
      return (
        <SettingsSection id="downloads" title="Downloads" advanced>
          <span>rows</span>
        </SettingsSection>
      );
    }
    vi.doMock('@/components/settings/reading-settings', () => ({ ReadingSettings: AdvancedPage }));
    const { SettingsApp: App } = await import('../settings-app');
    render(<App linkSegments={['downloads']} />);
    expect(screen.getByTestId('settings-tab-reading')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(useSettingsStore.getState().showAdvancedSettings).toBe(true), { timeout: 3000 });
    await waitFor(() => expect(scrolled).toContain('downloads'));
  });
});
