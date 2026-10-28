import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';

// R5: an editor with unsaved changes asks before Mountain View's top bar
// leaves it, as the rail and the phone tab bar do.

const nav = vi.hoisted(() => ({ push: vi.fn(), followed: vi.fn() }));
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
  // Like next/link: the handler runs first, and a prevented click stays put.
  Link: ({ href, onClick, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) nav.followed(href);
        e.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

const { MvTopBar } = await import('../mv-top-bar');
const { registerLeaveGuard } = await import('@/lib/leave-guard');
const { useSettingsStore } = await import('@/stores/settings-store');
const { useAccountStore } = await import('@/stores/account-store');
const { usePolicyStore } = await import('@/stores/policy-store');
const { DEFAULT_POLICY } = await import('@/lib/admin/types');

let unregister: (() => void) | null = null;
let confirm: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

beforeEach(() => {
  nav.push.mockClear();
  nav.followed.mockClear();
  usePolicyStore.setState({ policy: { ...DEFAULT_POLICY, features: { ...DEFAULT_POLICY.features, unifiedCrossAccountEnabled: true } } });
  useSettingsStore.setState({ enableUnifiedMailbox: true, unifiedCrossAccount: true } as never);
  useAccountStore.setState({ accounts: [{ id: 'a', isConnected: true }, { id: 'b', isConnected: true }] } as never);
  confirm = vi.fn(async () => true);
  unregister = registerLeaveGuard({ isDirty: () => true, confirm });
});
afterEach(() => { unregister?.(); unregister = null; });

describe('Mountain View top bar with unsaved changes', () => {
  it('asks before the Settings button leaves, then goes on', async () => {
    render(<MvTopBar showMenuButton={false} />);
    fireEvent.click(screen.getByRole('link', { name: 'settings' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(nav.followed).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.followed).toHaveBeenCalledWith('/settings'));
  });

  it('stays when the user keeps editing', async () => {
    confirm.mockResolvedValue(false);
    render(<MvTopBar showMenuButton={false} />);
    fireEvent.click(screen.getByRole('link', { name: 'Mail' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(nav.followed).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('asks before an app in the apps menu, and opens it after the menu has closed', async () => {
    render(<MvTopBar showMenuButton={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'add_app' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'mail' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(nav.followed).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  });

  it('asks before "All inboxes" opens mail', async () => {
    render(<MvTopBar showMenuButton={false} />);
    act(() => switcher.onSelectAllInboxes!());
    expect(confirm).toHaveBeenCalledOnce();
    expect(nav.push).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  });
});
