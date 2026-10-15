import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { usePluginStore } from '@/stores/plugin-store';
import { useThemeStore } from '@/stores/theme-store';

// A visitor without a session is sent to the login page. Before anything was
// signed in on this page load that is a client-side navigation: a reload
// downloaded and started the whole app a second time just to show the form.
// After a session ended, the reload stays, since it is what clears the mail.

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/en',
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
const hardNav = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browser-navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/browser-navigation')>()),
  replaceWindowLocation: hardNav,
}));

vi.mock('@/components/layout/sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/calendar-event-notification-toaster', () => ({ CalendarEventNotificationToaster: () => null }));
vi.mock('@/components/layout/share-notification-toaster', () => ({ ShareNotificationToaster: () => null }));
vi.mock('@/components/layout/mobile-header', () => ({ MobileHeader: () => null }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ activeTour: null, registerStep: vi.fn() }) }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-identity-sync', () => ({ useIdentitySync: () => {} }));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({ useProMultiAccountIdentities: () => [] }));
vi.mock('@/hooks/use-pro-multi-account-mailboxes', () => ({ useProMultiAccountMailboxes: () => {} }));
vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => null, canWopiOpen: () => false }));
vi.mock('@/hooks/use-browser-navigation', () => ({ useBrowserNavigation: () => {} }));
vi.mock('@/lib/push-bindings', () => ({ reconcilePushBindings: () => {}, releasePushBindings: () => {} }));
vi.mock('@/components/email/email-list', () => ({ EmailList: () => null }));

const { MailApp } = await import('../mail-app');

beforeEach(() => {
  nav.replace.mockReset();
  hardNav.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) });
  useEmailStore.setState({ emails: [], mailboxes: [], selectedEmail: null } as never);
  // checkAuth finding no account to restore.
  useAuthStore.setState({ isAuthenticated: false, isLoading: false, client: null, checkAuth: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mail view without a session', () => {
  it('leaves the viewer and editor code alone while sending the visitor to log in', async () => {
    const idle = vi.fn(() => 1);
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    render(<MailApp />);
    await act(async () => {});
    expect(nav.replace).toHaveBeenCalledWith('/login');
    expect(idle).not.toHaveBeenCalled();
  });

  it('opens the login page in place when nothing was signed in yet', async () => {
    render(<MailApp />);
    await act(async () => {});
    expect(nav.replace).toHaveBeenCalledWith('/login');
    expect(hardNav).not.toHaveBeenCalled();
  });

  it('reloads into the login page once a session was used on this page', async () => {
    act(() => { useAuthStore.setState({ isAuthenticated: true }); });
    act(() => { useAuthStore.setState({ isAuthenticated: false }); });
    render(<MailApp />);
    await act(async () => {});
    expect(nav.replace).not.toHaveBeenCalled();
    expect(hardNav).toHaveBeenCalledWith(expect.stringMatching(/\/login$/));
  });
});
