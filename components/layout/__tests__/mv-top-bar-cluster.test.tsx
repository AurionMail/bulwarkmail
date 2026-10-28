import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mountain View's right-hand cluster is the same in every app: the keyboard
// shortcuts button and the avatar's "All inboxes" row work outside mail too.

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const switcher = vi.hoisted(() => ({ onSelectAllInboxes: undefined as undefined | (() => void) }));

vi.mock('../account-switcher', () => ({
  AccountSwitcher: (props: { onSelectAllInboxes?: () => void }) => {
    switcher.onSelectAllInboxes = props.onSelectAllInboxes;
    return null;
  },
}));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-stalwart-admin', () => ({ useStalwartAdmin: () => false }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: nav.push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/calendar',
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

const { MvTopBar } = await import('../mv-top-bar');
const { useSettingsStore } = await import('@/stores/settings-store');
const { useAccountStore } = await import('@/stores/account-store');
const { usePolicyStore } = await import('@/stores/policy-store');
const { DEFAULT_POLICY } = await import('@/lib/admin/types');
const appCommands = await import('@/lib/app-commands');

const twoAccounts = [
  { id: 'a', isConnected: true },
  { id: 'b', isConnected: true },
];

beforeEach(() => {
  nav.push.mockClear();
  switcher.onSelectAllInboxes = undefined;
  usePolicyStore.setState({ policy: { ...DEFAULT_POLICY, features: { ...DEFAULT_POLICY.features, unifiedCrossAccountEnabled: true } } });
  useSettingsStore.setState({ enableUnifiedMailbox: true, unifiedCrossAccount: true } as never);
  useAccountStore.setState({ accounts: twoAccounts } as never);
});

describe('Mountain View top bar outside mail', () => {
  it('opens the keyboard shortcuts without a handler from the app', () => {
    const opened = vi.fn();
    window.addEventListener(appCommands.KEYBOARD_SHORTCUTS_OPEN_EVENT, opened);
    render(<MvTopBar showMenuButton={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'keyboard_shortcuts' }));
    expect(opened).toHaveBeenCalled();
    window.removeEventListener(appCommands.KEYBOARD_SHORTCUTS_OPEN_EVENT, opened);
  });

  it('offers "All inboxes" and opens mail on it', () => {
    render(<MvTopBar showMenuButton={false} />);
    expect(switcher.onSelectAllInboxes).toBeTypeOf('function');
    act(() => switcher.onSelectAllInboxes!());
    expect(nav.push).toHaveBeenCalledWith('/');
    expect(appCommands.peekParkedAppCommand()).toBe('all-inboxes');
  });

  it('leaves "All inboxes" out when the merged inbox cannot be built', () => {
    useAccountStore.setState({ accounts: [twoAccounts[0]] } as never);
    render(<MvTopBar showMenuButton={false} />);
    expect(switcher.onSelectAllInboxes).toBeUndefined();
  });
});
