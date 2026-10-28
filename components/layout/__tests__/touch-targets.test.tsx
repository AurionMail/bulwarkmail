import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Phone touch targets in the shell: every control gets the 44px hit area
// Buttons have on a touch screen (R1).

vi.mock('@/hooks/use-media-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-media-query')>()),
  useDeviceDetection: () => ({ isMobile: true, isTablet: false, isDesktop: false }),
}));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ startTour: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

const { NotificationPanel } = await import('@/components/notifications/notification-center');
const { WelcomeBanner } = await import('@/components/ui/welcome-banner');
const { ToastItem } = await import('@/components/ui/toast');
const { AccountSwitcher } = await import('../account-switcher');
const { useSettingsStore } = await import('@/stores/settings-store');
const { useAccountStore } = await import('@/stores/account-store');
const { useAuthStore } = await import('@/stores/auth-store');

const HIT = 'pointer-coarse:after:min-h-11';

describe('touch targets', () => {
  it('notification sheet header buttons', () => {
    render(<NotificationPanel onClose={vi.fn()} sheet />);
    for (const name of ['mark_all_read', 'clear', 'close']) {
      expect(screen.getByRole('button', { name }).className).toContain(HIT);
    }
  });

  it('welcome banner buttons', () => {
    useSettingsStore.setState({ onboardingCompleted: false });
    render(<WelcomeBanner />);
    for (const name of ['dismiss', 'start_tour', 'settings', 'got_it']) {
      expect(screen.getByRole('button', { name: new RegExp(name) }).className).toContain(HIT);
    }
  });

  it('toast action and close', () => {
    render(
      <ToastItem
        toast={{ id: 't', type: 'success', title: 'Archived', action: { label: 'Undo', onClick: vi.fn() } } as never}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Undo' }).className).toContain(HIT);
    expect(screen.getByRole('button', { name: 'close' }).className).toContain(HIT);
  });

  it('account avatar and popover rows', () => {
    useAccountStore.setState({ accounts: [
      { id: 'a', label: 'a', email: 'a@x', username: 'a@x', serverUrl: 'https://x', isConnected: true, isDefault: true, cookieSlot: 0 },
      { id: 'b', label: 'b', email: 'b@x', username: 'b@x', serverUrl: 'https://x', isConnected: true, isDefault: false, cookieSlot: 1 },
    ] } as never);
    useAuthStore.setState({ activeAccountId: 'b' } as never);
    useSettingsStore.setState({ interfaceLayout: 'default' } as never);
    render(<AccountSwitcher variant="header" />);
    const avatar = screen.getByTestId('account-switcher');
    expect(avatar.className).toContain('pointer-coarse:h-11');
    fireEvent.click(avatar);
    for (const name of ['add_account', 'set_as_default', /sign_out_of/, 'sign_out_all']) {
      expect(screen.getByRole('menuitem', { name }).className).toContain('pointer-coarse:min-h-11');
    }
  });
});
